import { SESSION_COOKIE, authEnabled, passwordMatches, signToken } from "@/lib/auth";
import { NextResponse } from "next/server";

// Very small in-memory brute-force limiter: 8 wrong passwords per 5 minutes per IP.
const attempts = new Map<string, { n: number; reset: number }>();

export async function POST(request: Request) {
  if (!authEnabled()) return NextResponse.json({ ok: true, viewerToken: "" });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const entry = attempts.get(ip);
  if (entry && entry.reset > now && entry.n >= 8) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { password?: unknown; app?: unknown };
  const password = typeof body.password === "string" ? body.password : "";
  if (!passwordMatches(password)) {
    attempts.set(ip, entry && entry.reset > now ? { n: entry.n + 1, reset: entry.reset } : { n: 1, reset: now + 300_000 });
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  attempts.delete(ip);

  const res = NextResponse.json({ ok: true, viewerToken: body.app ? signToken("viewer", 365) : undefined });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: signToken("session", 30),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 86_400,
  });
  return res;
}
