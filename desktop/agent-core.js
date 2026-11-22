"use strict";
// Agent core shared by the desktop app: reads battery/network/system stats and reports them.
const os = require("os");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const MB = 1024 * 1024;
const GB = 1024 * MB;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round1 = (n) => Math.round(n * 10) / 10;

function run(file, args = []) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 10000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : String(stdout));
    });
  });
}

function powershell(script) {
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
}

function osName() {
  const release = os.release();
  if (IS_WIN) {
    const build = Number(release.split(".")[2]) || 0;
    return `Windows ${build >= 22000 ? 11 : 10} (build ${build})`;
  }
  if (IS_MAC) return `macOS ${release}`;
  return `Linux ${release}`;
}

// ---------- Battery ----------

async function readBatteryWindows() {
  // PowerStatus gives percent, AC state and charging flag (bit 8 = charging).
  const out = await powershell(
    "Add-Type -AssemblyName System.Windows.Forms; " +
      "$p=[System.Windows.Forms.SystemInformation]::PowerStatus; " +
      "[pscustomobject]@{level=[math]::Round($p.BatteryLifePercent*100); ac=[int]$p.PowerLineStatus; flags=[int]$p.BatteryChargeStatus} | ConvertTo-Json -Compress",
  );
  if (!out || !out.trim()) return null;
  const s = JSON.parse(out.trim());
  if (typeof s.level !== "number" || s.level < 0) return null; // no battery (desktop)
  return {
    level: s.level,
    charging: (s.flags & 8) !== 0,
    powerSource: s.ac === 1 ? "AC" : s.ac === 0 ? "Battery" : null,
  };
}

function readBatteryLinux() {
  const base = "/sys/class/power_supply";
  const entries = fs.readdirSync(base);
  const read = (p) => {
    try {
      return fs.readFileSync(p, "utf8").trim();
    } catch {
      return null;
    }
  };
  let ac = false;
  let battery = null;
  for (const e of entries) {
    const type = read(path.join(base, e, "type"));
    if (type === "Mains" && read(path.join(base, e, "online")) === "1") ac = true;
    if (type === "Battery" && read(path.join(base, e, "capacity")) !== null) battery = path.join(base, e);
  }
  if (!battery) return null;
  const level = Number(read(path.join(battery, "capacity")));
  const status = read(path.join(battery, "status"));
  return { level, charging: status === "Charging", powerSource: ac ? "AC" : "Battery" };
}

async function readBatteryMac() {
  const out = await run("pmset", ["-g", "batt"]);
  if (!out) return null;
  const m = out.match(/(\d+)%;\s*([^;\n]+);?/);
  if (!m) return null;
  const status = m[2].trim();
  return {
    level: Number(m[1]),
    charging: /^(charging|finishing charge)$/i.test(status),
    powerSource: /'AC Power'/.test(out) ? "AC" : "Battery",
  };
}

async function readBattery() {
  try {
    if (IS_WIN) return await readBatteryWindows();
    if (IS_MAC) return await readBatteryMac();
    return readBatteryLinux();
  } catch {
    return null;
  }
}

// ---------- Network ----------

async function readNetwork() {
  let ip = null;
  let ifaceName = null;
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/loopback|vethernet|virtual|vmware|vbox|docker|bridge|tailscale|zerotier|tun|tap/i.test(name)) continue;
    const v4 = (addrs || []).find((a) => a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254."));
    if (v4) {
      ip = v4.address;
      ifaceName = name;
      break;
    }
  }
  if (!ip) return { type: "none", name: null, ip: null };

  let ssid = null;
  if (IS_WIN) {
    const out = await run("netsh", ["wlan", "show", "interfaces"]);
    const ssidMatch = out && out.match(/^\s*SSID\s*:\s*(.+?)\s*$/m);
    const stateMatch = out && out.match(/^\s*State\s*:\s*(.+?)\s*$/m);
    if (ssidMatch && stateMatch && /connected/i.test(stateMatch[1])) ssid = ssidMatch[1];
  } else if (IS_MAC) {
    const out = await run("networksetup", ["-getairportnetwork", "en0"]);
    const m = out && out.match(/Current Wi-Fi Network:\s*(.+)$/m);
    if (m) ssid = m[1].trim();
  } else {
    const out = await run("iwgetid", ["-r"]);
    if (out && out.trim()) ssid = out.trim();
  }

  if (ssid) return { type: "wifi", name: ssid, ip };
  const type = /wi-?fi|wlan|wireless/i.test(ifaceName) ? "wifi" : "ethernet";
  return { type, name: ifaceName, ip };
}

// ---------- Disk ----------

async function readDisk() {
  try {
    if (IS_WIN) {
      const drive = process.env.SystemDrive || "C:";
      const out = await powershell(
        `$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'"; ` +
          "[pscustomobject]@{size=[double]$d.Size; free=[double]$d.FreeSpace} | ConvertTo-Json -Compress",
      );
      const d = JSON.parse(out.trim());
      return { totalGb: round1(d.size / GB), usedGb: round1((d.size - d.free) / GB) };
    }
    const out = await run("df", ["-Pk", "/"]);
    const cols = out.trim().split("\n")[1].trim().split(/\s+/);
    return { totalGb: round1((Number(cols[1]) * 1024) / GB), usedGb: round1((Number(cols[2]) * 1024) / GB) };
  } catch {
    return null;
  }
}

// ---------- CPU (percent since the previous report) ----------

let lastCpu = null;
function cpuSnapshot() {
  return os.cpus().reduce(
    (acc, c) => {
      const total = Object.values(c.times).reduce((a, b) => a + b, 0);
      return { idle: acc.idle + c.times.idle, total: acc.total + total };
    },
    { idle: 0, total: 0 },
  );
}

async function readCpuPercent() {
  if (!lastCpu) {
    lastCpu = cpuSnapshot();
    await sleep(1000);
  }
  const now = cpuSnapshot();
  const total = now.total - lastCpu.total;
  const idle = now.idle - lastCpu.idle;
  lastCpu = now;
  return total > 0 ? round1((1 - idle / total) * 100) : null;
}

// ---------- Top apps (by memory, with CPU%) ----------

let procCache = { at: 0, value: null };
async function readTopProcesses() {
  if (Date.now() - procCache.at < 60000) return procCache.value;
  let list = null;
  try {
    if (IS_WIN) {
      const out = await powershell(
        "$a=@{};Get-Process|%{$a[$_.Id]=$_.CPU};Start-Sleep -Milliseconds 1000;$n=[Environment]::ProcessorCount;" +
          "Get-Process|%{$c=0;if($a.ContainsKey($_.Id) -and $_.CPU -ne $null -and $a[$_.Id] -ne $null){$c=($_.CPU-$a[$_.Id])/$n*100};" +
          "[pscustomobject]@{n=$_.Name;m=$_.WorkingSet64;c=$c}}|Group-Object n|%{[pscustomobject]@{name=$_.Name;" +
          "memoryMb=[math]::Round(($_.Group|Measure-Object m -Sum).Sum/1MB);cpu=[math]::Round(($_.Group|Measure-Object c -Sum).Sum,1)}}|" +
          "Sort-Object memoryMb -Descending|Select-Object -First 6|ConvertTo-Json -Compress",
      );
      if (out) {
        const parsed = JSON.parse(out);
        list = (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({ name: String(p.name), memoryMb: Number(p.memoryMb) || 0, cpu: Number(p.cpu) || 0 }));
      }
    } else {
      const out = await run("ps", ["-Ao", "rss=,comm="]);
      if (out) {
        const byName = new Map();
        for (const line of out.split("\n")) {
          const m = line.trim().match(/^(\d+)\s+(.+)$/);
          if (!m) continue;
          const name = path.basename(m[2]);
          byName.set(name, (byName.get(name) || 0) + Number(m[1]) / 1024);
        }
        list = [...byName.entries()].map(([name, mb]) => ({ name, memoryMb: Math.round(mb) })).sort((a, b) => b.memoryMb - a.memoryMb).slice(0, 6);
      }
    }
  } catch {
    list = null;
  }
  procCache = { at: Date.now(), value: list };
  return list;
}

// ---------- Collect and send ----------

async function collectMetrics() {
  const [battery, network, disk, cpuPercent, topProcesses] = await Promise.all([
    readBattery(),
    readNetwork(),
    readDisk(),
    readCpuPercent(),
    readTopProcesses(),
  ]);
  const totalMb = os.totalmem() / MB;
  const usedMb = totalMb - os.freemem() / MB;
  const cpus = os.cpus();

  return {
    battery,
    network,
    system: {
      os: osName(),
      cpuPercent,
      memoryUsedMb: Math.round(usedMb),
      memoryTotalMb: Math.round(totalMb),
      diskUsedGb: disk ? disk.usedGb : null,
      diskTotalGb: disk ? disk.totalGb : null,
      uptimeSeconds: Math.round(os.uptime()),
    },
    extra: {
      hostname: os.hostname(),
      cpuModel: cpus[0] ? cpus[0].model : null,
      cores: cpus.length,
      agent: "desktop-1.1",
      topProcesses,
    },
  };
}


async function pair(server, code, name) {
  const res = await fetch(`${server}/api/agent/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name, kind: "pc", os: osName() }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Pairing failed (HTTP ${res.status})`);
  return { token: data.token, deviceId: data.deviceId };
}

// Sends a heartbeat every ~30s. onStatus(text) for UI, onRemoved() if the dashboard removed this PC.
function startLoop({ server, token }, { onStatus, onRemoved }) {
  let stopped = false;
  (async () => {
    let intervalMs = 30000;
    let failures = 0;
    while (!stopped) {
      try {
        const metrics = await collectMetrics();
        const res = await fetch(`${server}/api/agent/heartbeat`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(metrics),
          signal: AbortSignal.timeout(20000),
        });
        if (res.status === 401) { stopped = true; onRemoved(); return; }
        if (!res.ok) throw new Error(`dashboard answered HTTP ${res.status}`);
        const data = await res.json().catch(() => ({}));
        if (data.intervalSeconds) intervalMs = data.intervalSeconds * 1000;
        failures = 0;
        onStatus(`Last update ${new Date().toLocaleTimeString()}`);
      } catch (err) {
        failures++;
        onStatus(`Retrying: ${err.message}`);
      }
      await sleep(failures ? Math.min(60000, 5000 * failures) : intervalMs);
    }
  })();
  return () => { stopped = true; };
}

module.exports = { pair, startLoop, osName };
