import { alertsSince, checkOffline, latestAlertId, recentAlerts } from "@/lib/alerts";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/alerts            -> 20 newest alerts (dashboard)
// GET /api/alerts?since=42   -> alerts with id > 42, oldest first (phone app polling)
// GET /api/alerts?since=latest -> just the newest id, so a new client starts from "now"
export async function GET(request: Request) {
  try {
    await checkOffline();
    const since = new URL(request.url).searchParams.get("since");
    if (since === "latest") return NextResponse.json({ alerts: [], latestId: await latestAlertId() });
    if (since !== null && /^\d+$/.test(since)) {
      const list = await alertsSince(Number(since));
      return NextResponse.json({ alerts: list, latestId: list.length ? list[list.length - 1].id : Number(since) });
    }
    const list = await recentAlerts(20);
    return NextResponse.json({ alerts: list, latestId: list[0]?.id ?? 0 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
