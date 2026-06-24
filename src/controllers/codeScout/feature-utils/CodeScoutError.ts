/**
 * Typed domain error for the code-scout domain (§8.3). Carries a machine code;
 * the error→HTTP status mapping lives in one handler (controllerResponses),
 * never scattered res.status() calls. Mirrors InterviewError / GbpAutomationError
 * (§6.1). The GitHub provider raises this with a PROVIDER_* code on auth/rate-
 * limit/read failure so the cause surfaces as a typed code, never as a leaked
 * stack trace or token (§3.4, §5.3).
 */
export class CodeScoutError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "CodeScoutError";
  }
}
