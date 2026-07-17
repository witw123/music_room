"use client";

import { FormEvent, useState } from "react";
import { adminApi } from "@/lib/admin-api";

export default function AdminLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await adminApi.login(username, password);
      window.location.assign("/admin");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "管理员登录失败。");
    } finally {
      setBusy(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-[#07080b] px-4 text-white">
    <section className="w-full max-w-md rounded-xl border border-white/[0.1] bg-white/[0.03] p-6 shadow-2xl sm:p-8">
      <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0070f3] text-sm font-semibold">MR</div><div><p className="font-semibold">Music Room</p><p className="text-xs text-white/40">管理员入口</p></div></div>
      <div className="mt-8 flex items-center gap-2 text-sm text-white/65"><span className="text-[#60a5fa]">[secure]</span> 仅限管理员账号访问</div>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="block text-sm text-white/65">用户名<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-[#0070f3]" required /></label>
        <label className="block text-sm text-white/65">密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-[#0070f3]" required /></label>
        {error ? <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        <button type="submit" disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0070f3] text-sm font-medium transition hover:bg-[#3291ff] disabled:opacity-50">{busy ? "登录中…" : "进入管理台"} -&gt;</button>
      </form>
    </section>
  </main>;
}
