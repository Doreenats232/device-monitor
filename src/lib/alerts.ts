import { db, pool } from "@/db";
import { alerts } from "@/db/schema";
import { ONLINE_WINDOW_MS } from "@/lib/monitor";
import { asc, desc, gt, sql } from "drizzle-orm";

const LOW_BATTERY = 20;
const HIGH_CPU = 90;

// The table also exists in schema.ts; this makes sure it is there even if migrations were not run.
let ready: Promise<unknown> | null = null;
export function ensureAlerts() {
  if (!ready) {
    ready = pool
      .query(
        `CREATE TABLE IF NOT EXISTS alerts (
          id serial PRIMARY KEY, device_id integer, device_name text NOT NULL, kind text NOT NULL,
          level text NOT NULL, text text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
      )
      .then(() => pool.query("CREATE INDEX IF NOT EXISTS alerts_created_idx ON alerts (created_at)"))
      .catch((e) => {
        ready = null;
        throw e;
      });
  }
  return ready;
}

type Alert = { deviceId: number; deviceName: string; kind: string; level: "info" | "warn" | "crit"; text: string };

async function add(a: Alert) {
  await db.insert(alerts).values(a);
}

export type PrevState = {
  name: string;
  lastSeenAt: Date | null;
  batteryLevel: number | null;
  charging: boolean | null;
  cpuPercent: number | null;
};

// Compare the previous snapshot with the new heartbeat and raise alerts for meaningful changes.
export async function detectAlerts(
  deviceId: number,
  prev: PrevState,
  next: { battery: { level: number; charging: boolean } | null; cpuPercent: number | null },
) {
  await ensureAlerts();
  const name = prev.name;
  const base = { deviceId, deviceName: name };

  if (prev.lastSeenAt && Date.now() - prev.lastSeenAt.getTime() > ONLINE_WINDOW_MS) {
    await add({ ...base, kind: "online", level: "info", text: `${name} is back online` });
  }
  const b = next.battery;
  if (b) {
    const wasLow = prev.batteryLevel != null && prev.batteryLevel <= LOW_BATTERY && !prev.charging;
    if (!b.charging && b.level <= LOW_BATTERY && !wasLow) {
      await add({ ...base, kind: "low_battery", level: "crit", text: `${name} battery low (${b.level}%)` });
    }
    if (b.charging && b.level >= 100 && (prev.batteryLevel ?? 0) < 100) {
      await add({ ...base, kind: "full", level: "info", text: `${name} is fully charged` });
    }
  }
  if ((next.cpuPercent ?? 0) >= HIGH_CPU && (prev.cpuPercent ?? 0) < HIGH_CPU) {
    await add({ ...base, kind: "high_cpu", level: "warn", text: `${name} CPU at ${Math.round(next.cpuPercent ?? 0)}%` });
  }
  if (Math.random() < 0.02) await db.delete(alerts).where(sql`${alerts.createdAt} < now() - interval '30 days'`);
}

// Devices stop sending heartbeats when they go offline, so this runs whenever someone asks for data.
// One "offline" alert per offline episode.
export async function checkOffline() {
  await ensureAlerts();
  const res = await pool.query(
    `SELECT d.id, d.name FROM devices d
     WHERE d.last_seen_at IS NOT NULL
       AND d.last_seen_at < now() - ($1 || ' milliseconds')::interval
       AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.device_id = d.id AND a.kind = 'offline' AND a.created_at > d.last_seen_at)`,
    [String(ONLINE_WINDOW_MS)],
  );
  for (const row of res.rows as { id: number; name: string }[]) {
    await add({ deviceId: row.id, deviceName: row.name, kind: "offline", level: "warn", text: `${row.name} went offline` });
  }
}

export type AlertRow = { id: number; deviceId: number | null; deviceName: string; kind: string; level: string; text: string; at: string };
const toRow = (r: typeof alerts.$inferSelect): AlertRow => ({
  id: r.id, deviceId: r.deviceId, deviceName: r.deviceName, kind: r.kind, level: r.level, text: r.text, at: r.createdAt.toISOString(),
});

export async function recentAlerts(limit = 20) {
  await ensureAlerts();
  return (await db.select().from(alerts).orderBy(desc(alerts.id)).limit(limit)).map(toRow);
}
export async function alertsSince(id: number) {
  await ensureAlerts();
  return (await db.select().from(alerts).where(gt(alerts.id, id)).orderBy(asc(alerts.id)).limit(50)).map(toRow);
}
export async function latestAlertId() {
  await ensureAlerts();
  const [r] = await db.select({ id: alerts.id }).from(alerts).orderBy(desc(alerts.id)).limit(1);
  return r?.id ?? 0;
}
