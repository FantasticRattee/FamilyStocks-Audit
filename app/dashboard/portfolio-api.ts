import { isEditPasswordValid, type EditAuthEnv } from "./edit-auth";
import type { MarketQuoteSnapshot } from "./portfolio-repository";
import {
  validateSharedHoldings,
  type PortfolioSettings,
  type SharedHoldingInput,
} from "./shared-portfolio";

export type PortfolioImportMetadata = {
  filename: string;
  importedAt: string;
  rowCount: number;
  contentHash: string;
};

export type SharedPortfolioState = {
  holdings: SharedHoldingInput[];
  settings: PortfolioSettings;
  quotes: Record<string, MarketQuoteSnapshot>;
  latestImport: PortfolioImportMetadata | null;
  marketSources?: Array<{ url: string; title: string }>;
};

export interface PortfolioRepository {
  loadOrSeed(seed: SharedPortfolioState): Promise<SharedPortfolioState>;
  replaceHoldings(
    holdings: SharedHoldingInput[],
    metadata: Omit<PortfolioImportMetadata, "rowCount">,
  ): Promise<SharedPortfolioState>;
}

const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });

const contentHash = async (holdings: SharedHoldingInput[]) => {
  const bytes = new TextEncoder().encode(JSON.stringify(holdings));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
};

export async function handlePortfolioApiRequest(
  request: Request,
  env: EditAuthEnv,
  repository: PortfolioRepository,
  seed: SharedPortfolioState,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/api/portfolio") {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed." }, 405, { allow: "GET" });
    }
    try {
      return jsonResponse(await repository.loadOrSeed(seed));
    } catch {
      return jsonResponse(
        { error: "Shared portfolio database is unavailable." },
        503,
      );
    }
  }

  if (url.pathname !== "/api/portfolio/import") return null;
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, { allow: "POST" });
  }
  if (!env.EDIT_MODE_PASSWORD) {
    return jsonResponse({ error: "Edit Mode authentication is unavailable." }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON request." }, 400);
  }
  if (!body || typeof body !== "object") {
    return jsonResponse({ error: "Invalid import request." }, 400);
  }
  const payload = body as Record<string, unknown>;
  if (typeof payload.password !== "string") {
    return jsonResponse({ error: "Edit Mode password is required." }, 400);
  }
  if (!(await isEditPasswordValid(payload.password, env.EDIT_MODE_PASSWORD))) {
    return jsonResponse({ error: "Incorrect password." }, 401);
  }
  if (typeof payload.filename !== "string" || !payload.filename.trim()) {
    return jsonResponse({ error: "Import filename is required." }, 400);
  }

  let holdings: SharedHoldingInput[];
  try {
    holdings = validateSharedHoldings(payload.holdings);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Invalid holdings." },
      400,
    );
  }

  try {
    await repository.loadOrSeed(seed);
    const importedAt = new Date().toISOString();
    const next = await repository.replaceHoldings(holdings, {
      filename: payload.filename.trim().slice(0, 255),
      importedAt,
      contentHash: await contentHash(holdings),
    });
    return jsonResponse(next);
  } catch {
    return jsonResponse(
      { error: "Shared portfolio database could not save this import." },
      503,
    );
  }
}
