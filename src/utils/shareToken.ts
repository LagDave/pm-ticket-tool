/**
 * Share-token generation (§5.1). A ticket's public share link is guarded by an
 * unguessable capability token: 256 bits of CSPRNG randomness, URL-safe base64
 * so it drops cleanly into a query string. The token IS the capability — anyone
 * holding it can read the ticket — so guessing it must be infeasible (spec Risk).
 * Pure and dependency-free (Node crypto); lives in src/utils per §6.2.
 */
import { randomBytes } from "crypto";

/** 256-bit token — 32 bytes of CSPRNG output. Named, not magic (§4.2). */
const SHARE_TOKEN_BYTES = 32;

/** A fresh URL-safe (base64url) share token. Distinct on every call. */
export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}
