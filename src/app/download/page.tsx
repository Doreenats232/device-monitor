const REPO = "https://github.com/Doreenats232/device-monitor/releases/download/latest";

export const metadata = { title: "Download · Device Monitor" };

export default function DownloadPage() {
  const items = [
    { icon: "📱", title: "Android app", file: "DeviceMonitor.apk", note: "Phone agent, alerts and in-app dashboard. Allow “install unknown apps” when asked." },
    { icon: "💻", title: "Windows app", file: "DeviceMonitor.exe", note: "One app: monitor, be monitored, or both. Windows may show a SmartScreen warning — choose “More info → Run anyway”." },
  ];
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-14">
      <p className="bg-gradient-to-r from-sky-300 to-violet-300 bg-clip-text text-sm font-semibold uppercase tracking-[0.18em] text-transparent">Device Monitor</p>
      <h1 className="mt-2 text-4xl font-semibold text-white">Download the apps</h1>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {items.map((i) => (
          <a key={i.file} href={`${REPO}/${i.file}`} className="glass block rounded-3xl p-6 transition hover:brightness-125">
            <p className="text-4xl">{i.icon}</p>
            <h2 className="mt-3 text-xl font-semibold text-white">{i.title}</h2>
            <p className="mt-1 text-sm text-slate-400">{i.note}</p>
            <p className="mt-4 inline-block rounded-full bg-gradient-to-r from-sky-400 to-violet-400 px-4 py-2 text-sm font-semibold text-slate-950">Download {i.file}</p>
          </a>
        ))}
      </div>
      <p className="mt-8 text-sm text-slate-500">Only add devices whose owner knows and agrees.</p>
    </main>
  );
}
