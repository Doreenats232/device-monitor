import { db } from "@/db";
import { deviceMetrics, devices } from "@/db/schema";
import { HEARTBEAT_INTERVAL_SECONDS, hashToken, normalizeMetrics } from "@/lib/monitor";
import { and, eq, lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

// Agents POST their current metrics here every ~30 seconds.
// If the owner removes the device on the dashboard, this returns 401 and the agent stops.
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Missing device token" }, { status: 401 });
  }

  const [device] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.tokenHash, hashToken(token)))
    .limit(1);

  if (!device) {
    return NextResponse.json({ error: "Device is not paired or was removed" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const metrics = normalizeMetrics(body);
  if (!metrics) {
    return NextResponse.json({ error: "Invalid metrics payload" }, { status: 400 });
  }

  const now = new Date();

  await db
    .update(devices)
    .set({
      lastSeenAt: now,
      os: metrics.system.os ?? undefined,
      batteryLevel: metrics.battery?.level ?? null,
      charging: metrics.battery?.charging ?? null,
      powerSource: metrics.battery?.powerSource ?? null,
      networkType: metrics.network?.type ?? null,
      networkName: metrics.network?.name ?? null,
      ipAddress: metrics.network?.ip ?? null,
      cpuPercent: metrics.system.cpuPercent ?? null,
      memoryUsedMb: metrics.system.memoryUsedMb != null ? Math.round(metrics.system.memoryUsedMb) : null,
      memoryTotalMb: metrics.system.memoryTotalMb != null ? Math.round(metrics.system.memoryTotalMb) : null,
      diskUsedGb: metrics.system.diskUsedGb ?? null,
      diskTotalGb: metrics.system.diskTotalGb ?? null,
      uptimeSeconds: metrics.system.uptimeSeconds != null ? Math.round(metrics.system.uptimeSeconds) : null,
      details: metrics.extra ?? null,
    })
    .where(eq(devices.id, device.id));

  await db.insert(deviceMetrics).values({
    deviceId: device.id,
    recordedAt: now,
    batteryLevel: metrics.battery?.level ?? null,
    cpuPercent: metrics.system.cpuPercent ?? null,
    memoryUsedMb: metrics.system.memoryUsedMb != null ? Math.round(metrics.system.memoryUsedMb) : null,
    networkName: metrics.network?.name ?? null,
  });

  // Keep history small: drop points older than 7 days for this device (roughly 1 in 20 heartbeats).
  if (Math.random() < 0.05) {
    await db
      .delete(deviceMetrics)
      .where(
        and(
          eq(deviceMetrics.deviceId, device.id),
          lt(deviceMetrics.recordedAt, sql`now() - interval '7 days'`),
        ),
      );
  }

  return NextResponse.json({ ok: true, intervalSeconds: HEARTBEAT_INTERVAL_SECONDS });
}
