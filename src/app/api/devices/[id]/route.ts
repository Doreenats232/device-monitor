import { db } from "@/db";
import { devices } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function parseId(id: string) {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Rename a device.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const deviceId = parseId((await params).id);
  if (!deviceId) return NextResponse.json({ error: "Invalid device id" }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const updated = await db.update(devices).set({ name }).where(eq(devices.id, deviceId)).returning({ id: devices.id });
  if (updated.length === 0) return NextResponse.json({ error: "Device not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// Removes a device. Its agent gets a 401 on the next heartbeat and stops.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const deviceId = parseId((await params).id);
  if (!deviceId) return NextResponse.json({ error: "Invalid device id" }, { status: 400 });
  const deleted = await db.delete(devices).where(eq(devices.id, deviceId)).returning({ id: devices.id });
  if (deleted.length === 0) return NextResponse.json({ error: "Device not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
