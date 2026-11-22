"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Login failed");
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="glass w-full max-w-sm rounded-3xl p-8">
        <p className="bg-gradient-to-r from-sky-300 to-violet-300 bg-clip-text text-sm font-semibold uppercase tracking-[0.18em] text-transparent">Device Monitor</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Sign in</h1>
        <p className="mt-1 text-sm text-slate-400">Enter the dashboard password.</p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && password && submit()}
          placeholder="Password"
          className="mt-5 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none"
        />
        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
        <button
          onClick={submit}
          disabled={busy || !password}
          className="mt-5 w-full rounded-2xl bg-gradient-to-r from-sky-400 to-violet-400 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </main>
  );
}
