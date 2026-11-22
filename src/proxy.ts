import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, verifyToken } from "@/lib/auth";

const PUBLIC_PREFIXES = ["/login", "/download", "/api/auth/", "/api/agent/", "/api/health"];

// Password gate for the dashboard. Device agents (/api/agent/*) keep using their own device tokens.
export function proxy(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();

  if (verifyToken(req.cookies.get(SESSION_COOKIE)?.value, "session")) return NextResponse.next();

  // The Android app polls alerts with a long-lived "viewer" token (alerts only).
  if (pathname === "/api/alerts") {
    const auth = req.headers.get("authorization") ?? "";
    if (auth.startsWith("Bearer ") && verifyToken(auth.slice(7).trim(), "viewer")) return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
