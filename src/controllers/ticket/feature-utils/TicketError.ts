/**
 * Typed domain error for the ticket domain (§8.3). Carries a machine code; the
 * error→HTTP status mapping lives in one handler (controllerResponses), never
 * scattered res.status() calls. Mirrors InterviewError / GbpAutomationError (§6.1).
 */
export class TicketError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "TicketError";
  }
}
