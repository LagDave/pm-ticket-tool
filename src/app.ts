/**
 * Express app factory. Wires security headers (Helmet), explicit CORS, Pino
 * request logging, JSON parsing, the route tree, and the error/404 backstops
 * (§11.4, §9.1, §3.4). Kept separate from index.ts so tests import the app
 * without binding a port. No business logic lives here (§7.2).
 */
import cors from "cors";
import express, { Application } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { config } from "./config";
import { logger } from "./config/logger";
import { errorHandler, notFoundHandler } from "./middleware/error";
import healthRouter from "./routes/health";
import interviewEngineRouter from "./routes/interviewEngine";
import interviewSessionsRouter from "./routes/interviewSessions";
import projectsRouter from "./routes/projects";
import sharedTicketsRouter from "./routes/sharedTickets";
import ticketsRouter from "./routes/tickets";

export function createApp(): Application {
  const app = express();

  // Security headers (§11.4).
  app.use(helmet());

  // Explicit CORS allow-list — never a wildcard in prod (§11.4).
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
    }),
  );

  // Pino request logging — no console.* (§9.1).
  app.use(pinoHttp({ logger }));

  app.use(express.json({ limit: "1mb" }));

  // Route tree (thin routes, §7.2). The engine router extends the sessions
  // resource with /:id/interview… paths; it is mounted alongside (not over) the
  // foundation sessions router, whose paths (/ and /:id) do not collide (spec 2 T5).
  app.use("/health", healthRouter);
  // Project context & bits (spec project-context-bits): owns /projects CRUD and
  // /projects/:id/bits. Its paths do not collide with the sessions/engine/ticket
  // routers below.
  app.use("/projects", projectsRouter);
  app.use("/sessions", interviewSessionsRouter);
  app.use("/sessions", interviewEngineRouter);
  // Ticket-draft (spec 3): mounted at "/" — it owns POST /sessions/:id/ticket
  // (generation off the session resource) and the /tickets/:ticketId reads/edits.
  // These paths do not collide with the sessions/engine routers above.
  app.use("/", ticketsRouter);
  // Public read-only shared ticket (spec What): the one unauthenticated route,
  // mounted at "/" with an absolute /shared/tickets/:token path. No ownerContext;
  // the capability token authorizes the read, and the router rate-limits +
  // validates it (§11.1 public-route exception, §11.3). No path collision above.
  app.use("/", sharedTicketsRouter);

  // Backstops — must be last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
