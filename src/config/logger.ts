/**
 * Pino logger instance — the ONLY logging path (§9.1). No `console.*` in
 * production code. Levels follow §9.2; include request/entity context at the
 * call site (§9.3).
 */
import pino from "pino";
import { config } from "./index";

export const logger = pino({
  level: config.logLevel,
  // Pretty transport only outside production; structured JSON in prod.
  transport:
    config.nodeEnv === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  // Defensive redaction so tokens/secrets never reach the logs (§5.3).
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.token",
      "*.anthropicApiKey",
    ],
    censor: "[redacted]",
  },
});
