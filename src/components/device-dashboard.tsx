"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type HistoryPoint = { t: string; battery: number | null; cpu: number | null; memoryUsedMb: number | null };

type DeviceView = {
  id: number;
  name: string;
  kind: string;
  os: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  online: boolean;
  battery: { level: number; charging: boolean; powerSource: string | null } | null;
  network: { type: string; name: string | null; ip: string | null } | null;
  system: {
    cpuPercent: number | null;
    memoryUsedMb: number | null;
    memoryTotalMb: number | null;
    diskUsedGb: number | null;
    diskTotalGb: number | null;
    uptimeSeconds: number | null;
  };
  details: Record<string, unknown> | null;
  history: HistoryPoint[];
};

type Alert = { id: string; deviceId: number; level: "warn" | "crit" | "info"; text: string; at: number };
type PairingState = { code: string; expiresAt: string } | null;
type Filter = "all" | "online" | "offline" | "pc" | "android";

const KIND_ICON: Record<string, string> = { pc: "💻", android: "📱", other: "🔌" };
const NET_ICON: Record<string, string> = { wifi: "📶", ethernet: "🔗", cellular: "📡", vpn: "🛡️", none: "⛔" };
const LOW_BATTERY = 20;
const HIGH_CPU = 90;

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function formatUptime(s: number | null): string {
  if (s == null) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function tone(value: number, invert = false): string {
  const v = invert ? 100 - value : value;
  if (v > 85) return "#f87171";
  if (v > 65) return "#fbbf24";
  return "#38bdf8";
}

function batteryTone(level: number, charging: boolean): string {
  if (charging) return "#34d399";
  if (level > 50) return "#34d399";
  if (level > LOW_BATTERY) return "#fbbf24";
  return "#f87171";
}

// Estimate time left from the battery trend in the history window.
function batteryEta(d: DeviceView): string | null {
  const pts = d.history.filter((p) => p.battery != null);
  if (!d.battery || pts.length < 4) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const hours = (new Date(last.t).getTime() - new Date(first.t).getTime()) / 3_600_000;
  const delta = (last.battery as number) - (first.battery as number);
  if (hours < 0.05 || delta === 0) return null;
  const rate = delta / hours; // % per hour
  if (d.battery.charging && rate > 0) {
    const h = (100 - d.battery.level) / rate;
    return h < 24 ? `~${formatUptime(h * 3600)} to full` : null;
  }
  if (!d.battery.charging && rate < 0) {
    const h = d.battery.level / -rate;
    return h < 72 ? `~${formatUptime(h * 3600)} left` : null;
  }
  return null;
}

function Ring({ value, color, label, sub, size = 84 }: { value: number | null; color: string; label: string; sub?: string; size?: number }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.08)" strokeWidth="8" fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={c}
            strokeDashoffset={c - (v / 100) * c}
            style={{ transition: "stroke-dashoffset .8s ease, stroke .4s", filter: `drop-shadow(0 0 6px ${color}66)` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-base font-semibold">
          {value == null ? "—" : `${Math.round(v)}%`}
        </div>
      </div>
      <p className="mt-1 text-xs font-medium text-slate-300">{label}</p>
      {sub ? <p className="text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

function AreaChart({ points, pick, color, max = 100, height = 64 }: { points: HistoryPoint[]; pick: (p: HistoryPoint) => number | null; color: string; max?: number; height?: number }) {
  const vals = points.map(pick);
  const have = vals.filter((v): v is number => v != null);
  if (have.length < 2) return <p className="py-4 text-xs text-slate-500">Chart appears after a few minutes of data.</p>;
  const w = 300;
  const step = w / (vals.length - 1);
  const y = (v: number) => height - (Math.max(0, Math.min(max, v)) / max) * (height - 4) - 2;
  let line = "";
  vals.forEach((v, i) => {
    if (v == null) return;
    line += `${line ? "L" : "M"}${(i * step).toFixed(1)},${y(v).toFixed(1)} `;
  });
  const area = `${line}L${((vals.length - 1) * step).toFixed(1)},${height} L0,${height} Z`;
  const gid = `g${color.replace("#", "")}${height}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Bar({ label, right, value, color }: { label: string; right: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span className="text-slate-300">{right}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
      </div>
    </div>
  );
}

function BluetoothList({ details }: { details: Record<string, unknown> | null }) {
  const list = details && Array.isArray(details.bluetooth) ? (details.bluetooth as unknown[]) : [];
  const items = list
    .filter((x): x is { name: string; battery?: number | null } => Boolean(x) && typeof x === "object" && typeof (x as { name?: unknown }).name === "string")
    .slice(0, 8);
  if (items.length === 0) return null;
  return (
    <div className="mt-4 rounded-2xl bg-white/5 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Bluetooth</p>
      <ul className="space-y-1.5">
        {items.map((b, i) => (
          <li key={`${b.name}-${i}`} className="flex items-center justify-between text-sm text-slate-200">
            <span className="truncate">🎧 {b.name}</span>
            <span className="ml-2 shrink-0 font-medium text-slate-300">{typeof b.battery === "number" ? `${b.battery}%` : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeviceCard({
  device,
  expanded,
  onToggle,
  onRemove,
  onRename,
}: {
  device: DeviceView;
  expanded: boolean;
  onToggle: () => void;
  onRemove: (id: number) => void;
  onRename: (id: number, name: string) => void;
}) {
  const b = device.battery;
  const s = device.system;
  const memPct = s.memoryUsedMb != null && s.memoryTotalMb ? (s.memoryUsedMb / s.memoryTotalMb) * 100 : null;
  const diskPct = s.diskUsedGb != null && s.diskTotalGb ? (s.diskUsedGb / s.diskTotalGb) * 100 : null;
  const netType = device.network?.type ?? "unknown";
  const eta = batteryEta(device);
  const lowBattery = b && !b.charging && b.level <= LOW_BATTERY;

  return (
    <article className={`glass fade-up flex flex-col rounded-3xl p-5 shadow-2xl shadow-black/30 transition ${device.online ? "" : "opacity-70"} ${lowBattery ? "ring-1 ring-red-400/50" : ""}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-lg font-semibold text-white">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-lg">{KIND_ICON[device.kind] ?? "🔌"}</span>
            <span className="truncate">{device.name}</span>
          </p>
          <p className="mt-1 truncate text-xs text-slate-400">{device.os ?? "Unknown OS"}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${device.online ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-slate-400"}`}>
            <span className={`h-2 w-2 rounded-full ${device.online ? "pulse bg-emerald-400" : "bg-slate-500"}`} />
            {device.online ? "Online" : "Offline"}
          </span>
          <span className="text-[11px] text-slate-500">Seen {timeAgo(device.lastSeenAt)}</span>
        </div>
      </header>

      <section className="mt-5 grid grid-cols-3 gap-2">
        <Ring
          value={b ? b.level : null}
          color={b ? batteryTone(b.level, b.charging) : "#64748b"}
          label={b?.charging ? "⚡ Battery" : "Battery"}
          sub={eta ?? (b ? b.powerSource ?? undefined : "none")}
        />
        <Ring value={s.cpuPercent} color={tone(s.cpuPercent ?? 0)} label="CPU" />
        <Ring value={memPct} color={tone(memPct ?? 0)} label="RAM" sub={s.memoryUsedMb != null && s.memoryTotalMb ? `${(s.memoryUsedMb / 1024).toFixed(1)}/${(s.memoryTotalMb / 1024).toFixed(0)} GB` : undefined} />
      </section>

      <section className="mt-5 rounded-2xl bg-white/5 p-3">
        <p className="text-sm font-medium text-slate-200">
          {NET_ICON[netType] ?? "🌐"} <span className="capitalize">{netType}</span>
          {device.network?.name ? <span className="text-slate-400"> · {device.network.name}</span> : null}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">IP {device.network?.ip ?? "—"}</p>
      </section>

      {diskPct != null ? (
        <div className="mt-4">
          <Bar label="Storage" right={`${s.diskUsedGb?.toFixed(0)} / ${s.diskTotalGb?.toFixed(0)} GB`} value={diskPct} color={tone(diskPct)} />
        </div>
      ) : null}

      {expanded ? (
        <section className="mt-5 grid gap-4 fade-up">
          <div>
            <p className="mb-1 text-xs font-medium text-slate-400">Battery · last 6 h</p>
            <AreaChart points={device.history} pick={(p) => p.battery} color="#34d399" />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-400">CPU · last 6 h</p>
            <AreaChart points={device.history} pick={(p) => p.cpu} color="#38bdf8" />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-400">Memory · last 6 h</p>
            <AreaChart
              points={device.history}
              pick={(p) => (p.memoryUsedMb != null && s.memoryTotalMb ? (p.memoryUsedMb / s.memoryTotalMb) * 100 : null)}
              color="#a78bfa"
            />
          </div>
          <BluetoothList details={device.details} />
          <dl className="grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div className="rounded-xl bg-white/5 p-2">
              <dt>Paired</dt>
              <dd className="text-slate-200">{new Date(device.createdAt).toLocaleDateString()}</dd>
            </div>
            <div className="rounded-xl bg-white/5 p-2">
              <dt>Uptime</dt>
              <dd className="text-slate-200">{formatUptime(s.uptimeSeconds)}</dd>
            </div>
            {typeof device.details?.model === "string" ? (
              <div className="rounded-xl bg-white/5 p-2">
                <dt>Model</dt>
                <dd className="truncate text-slate-200">{device.details.model as string}</dd>
              </div>
            ) : null}
            {typeof device.details?.cpuModel === "string" ? (
              <div className="rounded-xl bg-white/5 p-2">
                <dt>CPU</dt>
                <dd className="truncate text-slate-200">{device.details.cpuModel as string}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      <footer className="mt-5 flex items-center justify-between gap-2 border-t border-white/10 pt-4">
        <button onClick={onToggle} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-white/15">
          {expanded ? "Less" : "Details & charts"}
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => {
              const n = window.prompt("Rename device", device.name);
              if (n && n.trim()) onRename(device.id, n.trim());
            }}
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
          >
            Rename
          </button>
          <button onClick={() => onRemove(device.id)} className="rounded-full border border-red-400/30 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-400/10">
            Remove
          </button>
        </div>
      </footer>
    </article>
  );
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold" style={{ color: accent }}>
        {value}
      </p>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export default function DeviceDashboard() {
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingState>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [notify, setNotify] = useState(false);
  const prev = useRef<Map<number, DeviceView>>(new Map());
  const firstLoad = useRef(true);

  const pushAlert = useCallback((a: Omit<Alert, "at">) => {
    setAlerts((list) => (list.some((x) => x.id === a.id) ? list : [{ ...a, at: Date.now() }, ...list].slice(0, 20)));
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      new Notification("Device Monitor", { body: a.text });
    }
  }, []);

  // Detect changes between polls and raise alerts (low battery, offline, back online, charged, high CPU).
  const detect = useCallback(
    (list: DeviceView[]) => {
      if (!firstLoad.current) {
        for (const d of list) {
          const old = prev.current.get(d.id);
          if (!old) continue;
          const stamp = Math.floor(Date.now() / 600_000);
          if (old.online && !d.online) pushAlert({ id: `off-${d.id}-${stamp}`, deviceId: d.id, level: "warn", text: `${d.name} went offline` });
          if (!old.online && d.online) pushAlert({ id: `on-${d.id}-${stamp}`, deviceId: d.id, level: "info", text: `${d.name} is back online` });
          if (d.battery && !d.battery.charging && d.battery.level <= LOW_BATTERY && (!old.battery || old.battery.level > LOW_BATTERY || old.battery.charging))
            pushAlert({ id: `low-${d.id}-${stamp}`, deviceId: d.id, level: "crit", text: `${d.name} battery low (${d.battery.level}%)` });
          if (d.battery && old.battery && old.battery.level < 100 && d.battery.level === 100 && d.battery.charging)
            pushAlert({ id: `full-${d.id}-${stamp}`, deviceId: d.id, level: "info", text: `${d.name} is fully charged` });
          if ((d.system.cpuPercent ?? 0) >= HIGH_CPU && (old.system.cpuPercent ?? 0) < HIGH_CPU)
            pushAlert({ id: `cpu-${d.id}-${stamp}`, deviceId: d.id, level: "warn", text: `${d.name} CPU at ${Math.round(d.system.cpuPercent ?? 0)}%` });
        }
      }
      firstLoad.current = false;
      prev.current = new Map(list.map((d) => [d.id, d]));
    },
    [pushAlert],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = (await res.json()) as { devices: DeviceView[] };
      setDevices(data.devices);
      detect(data.devices);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load devices");
    } finally {
      setLoaded(true);
    }
  }, [detect]);

  useEffect(() => {
    setServerUrl(window.location.origin);
    setNotify(typeof Notification !== "undefined" && Notification.permission === "granted");
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  async function createPairingCode() {
    setPairingBusy(true);
    try {
      const res = await fetch("/api/pairing", { method: "POST" });
      const data = (await res.json()) as { code?: string; expiresAt?: string; error?: string };
      if (!res.ok || !data.code || !data.expiresAt) throw new Error(data.error ?? "Failed to create code");
      setPairing({ code: data.code, expiresAt: data.expiresAt });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create code");
    } finally {
      setPairingBusy(false);
    }
  }

  async function removeDevice(id: number) {
    if (!window.confirm("Remove this device? It stops reporting until paired again.")) return;
    const res = await fetch(`/api/devices/${id}`, { method: "DELETE" });
    if (!res.ok) return setError("Could not remove device");
    load();
  }

  async function renameDevice(id: number, name: string) {
    const res = await fetch(`/api/devices/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return setError("Could not rename device");
    load();
  }

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setNotify(p === "granted");
  }

  const toggle = (id: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices.filter((d) => {
      if (filter === "online" && !d.online) return false;
      if (filter === "offline" && d.online) return false;
      if ((filter === "pc" || filter === "android") && d.kind !== filter) return false;
      if (q && !`${d.name} ${d.os ?? ""} ${d.network?.name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [devices, filter, query]);

  const onlineCount = devices.filter((d) => d.online).length;
  const batteries = devices.filter((d) => d.battery).map((d) => d.battery!.level);
  const avgBattery = batteries.length ? Math.round(batteries.reduce((a, b) => a + b, 0) / batteries.length) : null;
  const lowCount = devices.filter((d) => d.battery && !d.battery.charging && d.battery.level <= LOW_BATTERY).length;

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "online", label: "Online" },
    { key: "offline", label: "Offline" },
    { key: "pc", label: "💻 PC" },
    { key: "android", label: "📱 Phone" },
  ];

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="bg-gradient-to-r from-sky-300 to-violet-300 bg-clip-text text-sm font-semibold uppercase tracking-[0.18em] text-transparent">Device Monitor</p>
          <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">Your devices</h1>
          <p className="mt-1 text-sm text-slate-400">Live · refreshes every 5 seconds</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!notify && typeof Notification !== "undefined" ? (
            <button onClick={enableNotifications} className="rounded-full border border-white/15 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/10">
              🔔 Enable alerts
            </button>
          ) : null}
          <button
            onClick={createPairingCode}
            disabled={pairingBusy}
            className="rounded-full bg-gradient-to-r from-sky-400 to-violet-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/20 hover:brightness-110 disabled:opacity-60"
          >
            {pairingBusy ? "Creating code…" : "+ Pair a device"}
          </button>
        </div>
      </header>

      <section className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Devices" value={String(devices.length)} hint="paired" accent="#e2e8f0" />
        <Stat label="Online" value={String(onlineCount)} hint={`${devices.length - onlineCount} offline`} accent="#34d399" />
        <Stat label="Avg battery" value={avgBattery == null ? "—" : `${avgBattery}%`} hint="across devices" accent="#38bdf8" />
        <Stat label="Low battery" value={String(lowCount)} hint={`≤ ${LOW_BATTERY}% unplugged`} accent={lowCount ? "#f87171" : "#94a3b8"} />
      </section>

      {error ? <div className="mt-6 rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      {alerts.length > 0 ? (
        <section className="glass mt-6 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Recent alerts</p>
            <button onClick={() => setAlerts([])} className="text-xs text-slate-400 hover:text-slate-200">
              Clear
            </button>
          </div>
          <ul className="mt-2 space-y-1.5">
            {alerts.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                <span className={a.level === "crit" ? "text-red-300" : a.level === "warn" ? "text-amber-300" : "text-sky-300"}>
                  {a.level === "crit" ? "🔴" : a.level === "warn" ? "🟠" : "🔵"} {a.text}
                </span>
                <span className="shrink-0 text-xs text-slate-500">{new Date(a.at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pairing ? (
        <section className="glass fade-up mt-6 rounded-3xl p-6 sm:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Pairing code</p>
              <p className="mt-2 bg-gradient-to-r from-sky-300 to-violet-300 bg-clip-text font-mono text-5xl font-semibold tracking-[0.2em] text-transparent">{pairing.code}</p>
              <p className="mt-3 text-sm text-slate-400">Expires {new Date(pairing.expiresAt).toLocaleTimeString()} · one use</p>
            </div>
            <div className="max-w-md text-sm text-slate-300">
              <p className="font-medium text-white">On the device to add:</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Open the PC agent or the Android app.</li>
                <li>
                  Server URL: <span className="break-all font-mono text-emerald-300">{serverUrl}</span>
                </li>
                <li>Enter the code and press Pair.</li>
              </ol>
              <p className="mt-3 text-xs text-slate-500">Only add devices whose owner knows and agrees. Owners can unpair any time.</p>
              <button onClick={() => setPairing(null)} className="mt-3 rounded-full border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10">
                Hide code
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {devices.length > 0 ? (
        <section className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3.5 py-1.5 text-sm transition ${filter === f.key ? "bg-white text-slate-900" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search devices…"
            className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none sm:w-64"
          />
        </section>
      ) : null}

      {!loaded ? (
        <p className="mt-16 text-center text-slate-400">Loading devices…</p>
      ) : devices.length === 0 ? (
        <section className="glass mt-12 rounded-3xl border-dashed p-12 text-center">
          <p className="text-5xl">🖥️</p>
          <h2 className="mt-4 text-2xl font-semibold text-white">No devices yet</h2>
          <p className="mx-auto mt-2 max-w-md text-slate-400">Click “Pair a device”, then enter the code in the PC agent or the Android app. Devices appear within 30 seconds.</p>
        </section>
      ) : visible.length === 0 ? (
        <p className="mt-12 text-center text-slate-400">No devices match.</p>
      ) : (
        <section className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((d) => (
            <DeviceCard key={d.id} device={d} expanded={expanded.has(d.id)} onToggle={() => toggle(d.id)} onRemove={removeDevice} onRename={renameDevice} />
          ))}
        </section>
      )}
    </main>
  );
}
