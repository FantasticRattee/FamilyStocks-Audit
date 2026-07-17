import { Pool, type PoolClient, type QueryResultRow } from "pg";

import type {
  PortfolioImportMetadata,
  PortfolioRepository,
  SharedPortfolioState,
} from "./portfolio-api";
import {
  mergePersistedMarketQuotes,
  SHARED_MARKET_KEYS,
  type MarketQuotePersistenceRepository,
  type MarketQuoteSnapshot,
  type MarketRefreshSource,
  type PersistableMarketRefresh,
  type PersistedMarketRefresh,
} from "./portfolio-repository";
import {
  validateSharedHoldings,
  type PortfolioSettings,
  type SharedHoldingInput,
} from "./shared-portfolio";

const DATABASE_LOCK_ID = 6688141;

type HoldingRow = QueryResultRow & {
  ticker: string;
  owner_account: string;
  entry_price: number;
  units: number;
};

type SettingsRow = QueryResultRow & { payload: PortfolioSettings };

type QuoteRow = QueryResultRow & {
  market_key: string;
  symbol: string;
  price: number;
  currency: string;
  exchange: string;
  market_state: string;
  quote_timestamp: Date | string;
  source: string | null;
  freshness: string | null;
  sources: MarketRefreshSource[] | null;
};

type ImportRow = QueryResultRow & {
  filename: string;
  imported_at: Date | string;
  row_count: number;
  content_hash: string;
};

const isoString = (value: Date | string) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const uniqueSources = (sourceGroups: Array<MarketRefreshSource[] | null>) => {
  const sources = new Map<string, MarketRefreshSource>();
  for (const source of sourceGroups.flatMap((group) => group ?? [])) {
    if (source?.url && !sources.has(source.url)) sources.set(source.url, source);
  }
  return [...sources.values()].slice(0, 12);
};

const quoteFromRow = (row: QuoteRow): MarketQuoteSnapshot => ({
  symbol: row.symbol,
  price: Number(row.price),
  currency: row.currency,
  exchange: row.exchange,
  marketState: row.market_state,
  quoteTimestamp: isoString(row.quote_timestamp),
  ...(row.source
    ? { source: row.source as MarketQuoteSnapshot["source"] }
    : {}),
  ...(row.freshness
    ? { freshness: row.freshness as MarketQuoteSnapshot["freshness"] }
    : {}),
});

export class PostgresPortfolioRepository
  implements PortfolioRepository, MarketQuotePersistenceRepository
{
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly pool: Pool) {}

  private async ensureSchema() {
    if (this.schemaReady) return this.schemaReady;
    const schemaSetup = this.pool.query(`
      CREATE TABLE IF NOT EXISTS portfolio_settings (
        id integer PRIMARY KEY CHECK (id = 1),
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS portfolio_holdings (
        id bigserial PRIMARY KEY,
        position_order integer NOT NULL,
        ticker text NOT NULL,
        owner_account text NOT NULL,
        entry_price double precision NOT NULL CHECK (entry_price > 0),
        units double precision NOT NULL CHECK (units > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS portfolio_holdings_position_order_idx
        ON portfolio_holdings (position_order);

      CREATE TABLE IF NOT EXISTS market_quotes (
        market_key text PRIMARY KEY,
        symbol text NOT NULL,
        price double precision NOT NULL CHECK (price > 0),
        currency text NOT NULL,
        exchange text NOT NULL,
        market_state text NOT NULL,
        quote_timestamp timestamptz NOT NULL,
        source text,
        freshness text,
        sources jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS portfolio_imports (
        id bigserial PRIMARY KEY,
        filename text NOT NULL,
        imported_at timestamptz NOT NULL,
        row_count integer NOT NULL CHECK (row_count > 0),
        content_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS portfolio_imports_imported_at_idx
        ON portfolio_imports (imported_at DESC, id DESC);
    `).then(() => undefined);
    this.schemaReady = schemaSetup.catch((error) => {
      this.schemaReady = null;
      throw error;
    });
    return this.schemaReady;
  }

  private async loadState(client: PoolClient): Promise<SharedPortfolioState> {
    const [settingsResult, holdingsResult, quotesResult, importResult] =
      await Promise.all([
        client.query<SettingsRow>(
          "SELECT payload FROM portfolio_settings WHERE id = 1",
        ),
        client.query<HoldingRow>(`
          SELECT ticker, owner_account, entry_price, units
          FROM portfolio_holdings
          ORDER BY position_order, id
        `),
        client.query<QuoteRow>(`
          SELECT market_key, symbol, price, currency, exchange, market_state,
                 quote_timestamp, source, freshness, sources
          FROM market_quotes
        `),
        client.query<ImportRow>(`
          SELECT filename, imported_at, row_count, content_hash
          FROM portfolio_imports
          ORDER BY imported_at DESC, id DESC
          LIMIT 1
        `),
      ]);

    const settings = settingsResult.rows[0]?.payload;
    if (!settings) throw new Error("Portfolio settings are missing.");
    const holdings = validateSharedHoldings(
      holdingsResult.rows.map((row) => ({
        ticker: row.ticker,
        ownerAccount: row.owner_account,
        entryPrice: Number(row.entry_price),
        units: Number(row.units),
      })),
    );
    const quotes = Object.fromEntries(
      quotesResult.rows.map((row) => [row.market_key, quoteFromRow(row)]),
    );
    const latest = importResult.rows[0];
    const latestImport: PortfolioImportMetadata | null = latest
      ? {
          filename: latest.filename,
          importedAt: isoString(latest.imported_at),
          rowCount: Number(latest.row_count),
          contentHash: latest.content_hash,
        }
      : null;
    const marketSources = uniqueSources(
      quotesResult.rows.map((row) => row.sources),
    );

    return {
      holdings,
      settings,
      quotes,
      latestImport,
      ...(marketSources.length ? { marketSources } : {}),
    };
  }

  async loadOrSeed(seed: SharedPortfolioState): Promise<SharedPortfolioState> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [DATABASE_LOCK_ID]);
      const existing = await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM portfolio_settings WHERE id = 1) AS exists",
      );
      if (!existing.rows[0]?.exists) {
        const holdings = validateSharedHoldings(seed.holdings);
        await client.query(
          "INSERT INTO portfolio_settings (id, payload) VALUES (1, $1::jsonb)",
          [JSON.stringify(seed.settings)],
        );
        for (const [index, holding] of holdings.entries()) {
          await client.query(
            `INSERT INTO portfolio_holdings
              (position_order, ticker, owner_account, entry_price, units)
             VALUES ($1, $2, $3, $4, $5)`,
            [index, holding.ticker, holding.ownerAccount, holding.entryPrice, holding.units],
          );
        }
        for (const key of SHARED_MARKET_KEYS) {
          const quote = seed.quotes[key];
          if (!quote) continue;
          await this.upsertQuote(client, key, quote, seed.marketSources ?? []);
        }
      }
      const state = await this.loadState(client);
      await client.query("COMMIT");
      return state;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async replaceHoldings(
    input: SharedHoldingInput[],
    metadata: Omit<PortfolioImportMetadata, "rowCount">,
    settingsOverride?: PortfolioSettings,
  ): Promise<SharedPortfolioState> {
    await this.ensureSchema();
    const holdings = validateSharedHoldings(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [DATABASE_LOCK_ID]);
      if (settingsOverride) {
        await client.query(
          `INSERT INTO portfolio_settings (id, payload, updated_at)
           VALUES (1, $1::jsonb, now())
           ON CONFLICT (id) DO UPDATE SET
             payload = EXCLUDED.payload,
             updated_at = now()`,
          [JSON.stringify(settingsOverride)],
        );
      }
      await client.query("DELETE FROM portfolio_holdings");
      for (const [index, holding] of holdings.entries()) {
        await client.query(
          `INSERT INTO portfolio_holdings
            (position_order, ticker, owner_account, entry_price, units)
           VALUES ($1, $2, $3, $4, $5)`,
          [index, holding.ticker, holding.ownerAccount, holding.entryPrice, holding.units],
        );
      }
      await client.query(
        `INSERT INTO portfolio_imports
          (filename, imported_at, row_count, content_hash)
         VALUES ($1, $2, $3, $4)`,
        [metadata.filename, metadata.importedAt, holdings.length, metadata.contentHash],
      );
      const state = await this.loadState(client);
      await client.query("COMMIT");
      return state;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertQuote(
    client: PoolClient,
    marketKey: string,
    quote: MarketQuoteSnapshot,
    sources: MarketRefreshSource[],
  ) {
    await client.query(
      `INSERT INTO market_quotes
        (market_key, symbol, price, currency, exchange, market_state,
         quote_timestamp, source, freshness, sources)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (market_key) DO UPDATE SET
         symbol = EXCLUDED.symbol,
         price = EXCLUDED.price,
         currency = EXCLUDED.currency,
         exchange = EXCLUDED.exchange,
         market_state = EXCLUDED.market_state,
         quote_timestamp = EXCLUDED.quote_timestamp,
         source = EXCLUDED.source,
         freshness = EXCLUDED.freshness,
         sources = EXCLUDED.sources,
         updated_at = now()`,
      [
        marketKey,
        quote.symbol,
        quote.price,
        quote.currency,
        quote.exchange,
        quote.marketState,
        quote.quoteTimestamp,
        quote.source ?? null,
        quote.freshness ?? null,
        JSON.stringify(sources),
      ],
    );
  }

  async loadRecentMarketRefresh(
    maxAgeMs: number,
  ): Promise<PersistedMarketRefresh | null> {
    await this.ensureSchema();
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return null;
    const rows = await this.pool.query<QuoteRow>(`
      SELECT market_key, symbol, price, currency, exchange, market_state,
             quote_timestamp, source, freshness, sources
      FROM market_quotes
    `);
    if (rows.rows.length === 0) return null;

    const latestTimestamp = Math.max(
      ...rows.rows.map((row) => Date.parse(isoString(row.quote_timestamp))),
    );
    if (
      !Number.isFinite(latestTimestamp) ||
      Date.now() - latestTimestamp >= maxAgeMs
    ) {
      return null;
    }

    const stored = Object.fromEntries(
      rows.rows.map((row) => [row.market_key, quoteFromRow(row)]),
    );
    const merged = mergePersistedMarketQuotes(stored, {
      quotes: {},
      failures: {},
    });
    const sources = uniqueSources(rows.rows.map((row) => row.sources));
    const provider = rows.rows.find(
      (row) =>
        Date.parse(isoString(row.quote_timestamp)) === latestTimestamp &&
        row.source,
    )?.source;
    return {
      ...merged,
      fetchedAt: new Date(latestTimestamp).toISOString(),
      ...(provider ? { provider } : {}),
      ...(sources.length ? { sources } : {}),
    };
  }

  async persistMarketRefresh(
    refresh: PersistableMarketRefresh,
  ): Promise<PersistedMarketRefresh> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [DATABASE_LOCK_ID]);
      for (const key of SHARED_MARKET_KEYS) {
        const quote = refresh.quotes[key];
        if (!quote) continue;
        await this.upsertQuote(client, key, quote, refresh.sources ?? []);
      }
      const rows = await client.query<QuoteRow>(`
        SELECT market_key, symbol, price, currency, exchange, market_state,
               quote_timestamp, source, freshness, sources
        FROM market_quotes
      `);
      const stored = Object.fromEntries(
        rows.rows.map((row) => [row.market_key, quoteFromRow(row)]),
      );
      const merged = mergePersistedMarketQuotes(stored, refresh);
      const sources = uniqueSources(rows.rows.map((row) => row.sources));
      await client.query("COMMIT");
      return {
        ...merged,
        fetchedAt: refresh.fetchedAt,
        ...(refresh.provider ? { provider: refresh.provider } : {}),
        ...(sources.length ? { sources } : {}),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

const repositories = new Map<string, PostgresPortfolioRepository>();

export function createPostgresPortfolioRepository(databaseUrl: string | undefined) {
  const connectionString = databaseUrl?.trim();
  if (!connectionString) return null;
  const cached = repositories.get(connectionString);
  if (cached) return cached;
  const parsed = new URL(connectionString);
  const useSsl = parsed.searchParams.get("sslmode") === "require";
  const repository = new PostgresPortfolioRepository(
    new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    }),
  );
  repositories.set(connectionString, repository);
  return repository;
}
