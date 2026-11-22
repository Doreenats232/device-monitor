import { createHash, createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "dm_session";
export const authEnabled = () => Boolean(process.env.DASHBOARD_PASSWORD);

const secret = () => process.env.SESSION_SECRET || `dm-secret:${process.env.DASHBOARD_PASSWORD ?? ""}`;
const sig = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export type TokenKind = "session" | "viewer";

// Signed, expiring token: "<kind>.<expiryMs>.<signature>". "viewer" tokens are for the phone app's alert polling only.
export function signToken(kind: TokenKind, days: number): string {
  const payload = `${kind}.${Date.now() + days * 86_400_000}`;
  return `${payload}.${sig(payload)}`;
}

export function verifyToken(token: string | undefined | null, kind: TokenKind): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== kind) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const a = Buffer.from(sig(payload));
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(parts[1]) > Date.now();
}

export function passwordMatches(input: string): boolean {
  const expected = createHash("sha256").update(process.env.DASHBOARD_PASSWORD ?? "").digest();
  const given = createHash("sha256").update(input).digest();
  return timingSafeEqual(expected, given);
}
