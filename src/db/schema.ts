import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// A device that has been paired with the dashboard (PC, Android phone, etc.).
// Only a SHA-256 hash of the device token is stored, never the token itself.
export const devices = pgTable("devices", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("other"), // pc | android | other
  os: text("os"),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),

  // Latest snapshot reported by the agent
  batteryLevel: integer("battery_level"),
  charging: boolean("charging"),
  powerSource: text("power_source"),
  networkType: text("network_type"),
  networkName: text("network_name"),
  ipAddress: text("ip_address"),
  cpuPercent: real("cpu_percent"),
  memoryUsedMb: integer("memory_used_mb"),
  memoryTotalMb: integer("memory_total_mb"),
  diskUsedGb: real("disk_used_gb"),
  diskTotalGb: real("disk_total_gb"),
  uptimeSeconds: integer("uptime_seconds"),
  details: jsonb("details"),
});

// Rolling history used for the battery / CPU charts on each device card.
export const deviceMetrics = pgTable(
  "device_metrics",
  {
    id: serial("id").primaryKey(),
    deviceId: integer("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    batteryLevel: integer("battery_level"),
    cpuPercent: real("cpu_percent"),
    memoryUsedMb: integer("memory_used_mb"),
    networkName: text("network_name"),
  },
  (table) => [index("device_metrics_device_time_idx").on(table.deviceId, table.recordedAt)],
);

// Short-lived 6-digit codes the dashboard shows so a new device can pair.
export const devicePairings = pgTable("device_pairings", {
  code: text("code").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Alerts raised by the server (low battery, offline, ...). Shown on the dashboard and pushed to the phone app.
export const alerts = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    deviceId: integer("device_id"),
    deviceName: text("device_name").notNull(),
    kind: text("kind").notNull(), // low_battery | full | offline | online | high_cpu
    level: text("level").notNull(), // info | warn | crit
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("alerts_created_idx").on(table.createdAt)],
);
