/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

import { handleEditAuthRequest } from "../app/dashboard/edit-auth";
import { INITIAL_SHARED_PORTFOLIO_STATE } from "../app/dashboard/initial-shared-portfolio";
import { handleMarketApiRequest } from "../app/dashboard/market-api";
import { handlePortfolioApiRequest } from "../app/dashboard/portfolio-api";
import { createPostgresPortfolioRepository } from "../app/dashboard/postgres-portfolio-repository";

interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> };
  DB?: unknown;
  DATABASE_URL?: string;
  EDIT_MODE_PASSWORD?: string;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type RuntimeSecret =
  | "DATABASE_URL"
  | "EDIT_MODE_PASSWORD";

const RUNTIME_SECRETS: RuntimeSecret[] = [
  "DATABASE_URL",
  "EDIT_MODE_PASSWORD",
];

const getNodeEnvironment = (): Partial<Record<RuntimeSecret, string>> => {
  const nodeProcess = (
    globalThis as typeof globalThis & {
      process?: { env?: Partial<Record<RuntimeSecret, string>> };
    }
  ).process;

  return nodeProcess?.env ?? {};
};

const resolveRuntimeEnvironment = (workerEnv?: Env): Env => {
  const resolvedEnv: Env = { ...(workerEnv ?? {}) };
  const nodeEnv = getNodeEnvironment();

  for (const secret of RUNTIME_SECRETS) {
    resolvedEnv[secret] = workerEnv?.[secret] ?? nodeEnv[secret];
  }

  return resolvedEnv;
};

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    env = resolveRuntimeEnvironment(env);
    const url = new URL(request.url);

    const editAuthResponse = await handleEditAuthRequest(request, env);
    if (editAuthResponse) return editAuthResponse;

    const portfolioRepository = createPostgresPortfolioRepository(env.DATABASE_URL);
    const isPortfolioRoute =
      url.pathname === "/api/portfolio" ||
      url.pathname === "/api/portfolio/import";
    if (isPortfolioRoute && !portfolioRepository) {
      return Response.json(
        { error: "Shared portfolio database is not configured. Add DATABASE_URL." },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    if (portfolioRepository) {
      const portfolioResponse = await handlePortfolioApiRequest(
        request,
        env,
        portfolioRepository,
        INITIAL_SHARED_PORTFOLIO_STATE,
      );
      if (portfolioResponse) return portfolioResponse;
    }

    if (url.pathname === "/api/market/refresh" && !portfolioRepository) {
      return Response.json(
        { error: "Shared portfolio database is not configured. Add DATABASE_URL." },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    if (url.pathname === "/api/market/refresh" && portfolioRepository) {
      try {
        await portfolioRepository.loadOrSeed(INITIAL_SHARED_PORTFOLIO_STATE);
      } catch {
        return Response.json(
          { error: "Shared portfolio database is unavailable." },
          { status: 503, headers: { "cache-control": "no-store" } },
        );
      }
    }
    const marketResponse = await handleMarketApiRequest(
      request,
      fetch,
      portfolioRepository ?? undefined,
    );
    if (marketResponse) return marketResponse;

    if (url.pathname === "/_vinext/image") {
      const assets = env.ASSETS;
      const images = env.IMAGES;
      if (!assets || !images) {
        return new Response("Image optimization is unavailable in this runtime.", {
          status: 503,
        });
      }
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => assets.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await images.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
