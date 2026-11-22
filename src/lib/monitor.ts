import { createHash, randomBytes, randomInt } from "crypto";

// A device is shown as "online" if it reported within this window.
// Agents send a heartbeat every 30 seconds.
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;
export const HEARTBEAT_INTERVAL_SECONDS = 30;
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateDeviceToken(): string {
  return randomBytes(32).toString("hex");
}

export function generatePairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export const DEVICE_KINDS = ["pc", "android", "other"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export type MetricsPayload = {
  battery: { level: number; charging: boolean; powerSource?: string | null } | null;
  network: { type: string; name: string | null; ip: string | null } | null;
  system: {
    os?: string | null;
    cpuPercent?: number | null;
    memoryUsedMb?: number | null;
    memoryTotalMb?: number | null;
    diskUsedGb?: number | null;
    diskTotalGb?: number | null;
    uptimeSeconds?: number | null;
  };
  extra?: Record<string, unknown> | null;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown, max = 200): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
}

// Validate and clamp whatever an agent sends so bad payloads can't break the DB.
export function normalizeMetrics(input: unknown): MetricsPayload | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, any>;

  const battery =
    raw.battery && typeof raw.battery === "object"
      ? {
          level: Math.max(0, Math.min(100, Math.round(num(raw.battery.level) ?? 0))),
          charging: Boolean(raw.battery.charging),
          powerSource: str(raw.battery.powerSource, 40),
        }
      : null;

  const network =
    raw.network && typeof raw.network === "object"
      ? {
          type: str(raw.network.type, 30) ?? "unknown",
          name: str(raw.network.name, 120),
          ip: str(raw.network.ip, 60),
        }
      : null;

  const s = raw.system && typeof raw.system === "object" ? raw.system : {};
  const system = {
    os: str(s.os, 120),
    cpuPercent: num(s.cpuPercent),
    memoryUsedMb: num(s.memoryUsedMb),
    memoryTotalMb: num(s.memoryTotalMb),
    diskUsedGb: num(s.diskUsedGb),
    diskTotalGb: num(s.diskTotalGb),
    uptimeSeconds: num(s.uptimeSeconds),
  };

  const extra =
    raw.extra && typeof raw.extra === "object" && !Array.isArray(raw.extra)
      ? (raw.extra as Record<string, unknown>)
      : null;

  return { battery, network, system, extra };
}
