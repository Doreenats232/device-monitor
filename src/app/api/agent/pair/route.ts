import { db } from "@/db";
import { devicePairings, devices } from "@/db/schema";
import {
  DEVICE_KINDS,
  HEARTBEAT_INTERVAL_SECONDS,
  generateDeviceToken,
  hashToken,
  type DeviceKind,
} from "@/lib/monitor";
import { and, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";

// Called by the PC or Android agent with the code shown on the dashboard.
// Returns a device token once; the agent stores it and uses it for heartbeats.
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "My device";
  const kind: DeviceKind = DEVICE_KINDS.includes(body.kind as DeviceKind)
    ? (body.kind as DeviceKind)
    : "other";
  const os = typeof body.os === "string" ? body.os.slice(0, 120) : null;

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Pairing code must be 6 digits" }, { status: 400 });
  }

  const [pairing] = await db
    .select()
    .from(devicePairings)
    .where(and(eq(devicePairings.code, code), gt(devicePairings.expiresAt, new Date())))
    .limit(1);

  if (!pairing) {
    return NextResponse.json(
      { error: "Code is wrong or expired. Generate a new code on the dashboard." },
      { status: 404 },
    );
  }

  const token = generateDeviceToken();
  const [device] = await db
    .insert(devices)
    .values({ name, kind, os, tokenHash: hashToken(token), lastSeenAt: new Date() })
    .returning({ id: devices.id });

  // A pairing code can only be used once.
  await db.delete(devicePairings).where(eq(devicePairings.code, code));

  return NextResponse.json(
    {
      deviceId: device.id,
      token,
      heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
    },
    { status: 201 },
  );
}
