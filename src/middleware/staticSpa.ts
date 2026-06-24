/**
 * SPA static-serving wiring for the single Railway service (deploy spec Rev 2).
 * On Railway one Express process serves BOTH the JSON API and the built React/
 * Vite SPA from one origin: this mounts `frontend/dist` as static assets and adds
 * a catch-all that returns `index.html` for any non-API route so client-side
 * routing works on a hard refresh / deep link. In local dev the Vite dev server
 * owns the SPA, so this is never mounted (guarded by config.serveStatic).
 *
 * No business logic lives here (§7.2 spirit — this is transport/asset wiring, not
 * a route handler). The API surface is untouched: the catch-all explicitly skips
 * the API prefix and the root health path, so /api/* and /health keep returning
 * the JSON envelope (and the 404 envelope, §8.1) instead of HTML. In the single-
 * service composition (server.ts) the whole Express API is mounted under /api, so
 * skipping /api is sufficient to leave every JSON route reachable.
 */
import fs from "fs";
import path from "path";
import express, { Application, NextFunction, Request, Response } from "express";
import { logger } from "../config/logger";

/**
 * Path prefixes owned by the server's non-SPA surface. A request whose path
 * starts with one of these must fall through (to the /api app or the root health
 * route), never the SPA shell — so an unknown API route still returns JSON
 * (§8.1), not index.html. `/api` is the whole mounted API; `/health` is the root
 * health alias kept for the platform health check.
 */
const API_PATH_PREFIXES = ["/api", "/health"] as const;

/** Candidate locations of the built SPA, relative to THIS file's compiled/runtime dir. */
function spaDirCandidates(): string[] {
  return [
    // Compiled: dist/src/middleware/ → repo root is three levels up.
    path.join(__dirname, "..", "..", "..", "frontend", "dist"),
    // Dev (tsx): src/middleware/ → repo root is two levels up.
    path.join(__dirname, "..", "..", "frontend", "dist"),
  ];
}

/**
 * Resolve the built SPA directory, or null when no build exists on disk. Returns
 * the first candidate that contains an `index.html` so the resolution is correct
 * whether the server runs compiled (dist/) or via tsx (src/). Never throws — a
 * missing build is logged and static serving is skipped (the API still serves).
 */
export function resolveSpaDir(): string | null {
  for (const dir of spaDirCandidates()) {
    if (fs.existsSync(path.join(dir, "index.html"))) {
      return dir;
    }
  }
  return null;
}

/** True when the request path belongs to the JSON API, not the SPA. */
function isApiPath(reqPath: string): boolean {
  return API_PATH_PREFIXES.some(
    (prefix) => reqPath === prefix || reqPath.startsWith(`${prefix}/`),
  );
}

/**
 * Mount static SPA serving + the client-routing catch-all onto the app. Call this
 * AFTER the API routers and BEFORE the 404/error backstops, so API routes win and
 * unmatched non-API GETs fall through to index.html. A no-op (logged) when the
 * build is absent, so a backend-only boot never crashes for a missing SPA.
 */
export function serveSpa(app: Application): void {
  const spaDir = resolveSpaDir();
  if (!spaDir) {
    logger.warn(
      { candidates: spaDirCandidates() },
      "SERVE_STATIC is on but no frontend/dist build was found; skipping SPA serving",
    );
    return;
  }

  const indexHtml = path.join(spaDir, "index.html");
  // Hashed asset files are immutable; let the browser cache them. index.html is
  // served by the catch-all (below) with no-cache so a new deploy is picked up.
  app.use(express.static(spaDir, { index: false }));

  // Client-routing catch-all: any non-API GET returns the SPA shell so a deep
  // link / refresh resolves in the browser. Non-GET and API paths fall through.
  app.get("*", (req: Request, res: Response, next: NextFunction): void => {
    if (isApiPath(req.path)) {
      next();
      return;
    }
    res.sendFile(indexHtml, (error) => {
      if (error) {
        logger.error({ err: error, route: req.path }, "Failed to send SPA index.html");
        next(error);
      }
    });
  });

  logger.info({ spaDir }, "Serving SPA static build (single-service mode)");
}
