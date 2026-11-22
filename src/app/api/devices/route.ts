import { db } from "@/db";
import { deviceMetrics, devices } from "@/db/schema";
import { checkOffline } from "@/lib/alerts";
import { ONLINE_WINDOW_MS } from "@/lib/monitor";
import { and, desc, gt, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HISTORY_POINTS_PER_DEVICE = 60;

// Dashboard data: every paired device with its latest snapshot and recent history.
export async function GET() {
  await checkOffline().catch(() => {});
  const rows = await db.select().from(devices).orderBy(devices.createdAt);
  const ids = rows.map((r) => r.id);

  const history = new Map<number, { t: string; battery: number | null; cpu: number | null; memoryUsedMb: number | null }[]>();
  if (ids.length > 0) {
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const points = await db
      .select()
      .from(deviceMetrics)
      .where(and(inArray(deviceMetrics.deviceId, ids), gt(deviceMetrics.recordedAt, since)))
      .orderBy(desc(deviceMetrics.recordedAt))
      .limit(ids.length * HISTORY_POINTS_PER_DEVICE * 2);

    for (const p of points) {
      const list = history.get(p.deviceId) ?? [];
      if (list.length < HISTORY_POINTS_PER_DEVICE) {
        list.push({
          t: p.recordedAt.toISOString(),
          battery: p.batteryLevel,
          cpu: p.cpuPercent,
          memoryUsedMb: p.memoryUsedMb,
        });
      }
      history.set(p.deviceId, list);
    }
  }

  const now = Date.now();
  const result = rows.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    os: d.os,
    createdAt: d.createdAt.toISOString(),
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    online: d.lastSeenAt ? now - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS : false,
    battery: d.batteryLevel == null ? null : { level: d.batteryLevel, charging: Boolean(d.charging), powerSource: d.powerSource },
    network: d.networkType
      ? { type: d.networkType, name: d.networkName, ip: d.ipAddress }
      : null,
    system: {
      cpuPercent: d.cpuPercent,
      memoryUsedMb: d.memoryUsedMb,
      memoryTotalMb: d.memoryTotalMb,
      diskUsedGb: d.diskUsedGb,
      diskTotalGb: d.diskTotalGb,
      uptimeSeconds: d.uptimeSeconds,
    },
    details: d.details,
    history: (history.get(d.id) ?? []).reverse(),
  }));

  return NextResponse.json({ devices: result, serverTime: new Date().toISOString() });
}
