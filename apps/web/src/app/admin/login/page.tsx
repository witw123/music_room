"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { adminApi } from "@/lib/network/admin-api";
import { musicRoomApi } from "@/lib/network/music-room-api";

export default function AdminLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [turnstileEnabled, setTurnstileEnabled] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  useEffect(() => {
    void musicRoomApi.getAuthConfig().then((config) => {
      setTurnstileEnabled(config.enabled && !!config.siteKey);
      setTurnstileSiteKey(config.siteKey);
    }).catch(() => undefined);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (turnstileEnabled && !turnstileToken) {
      setError("请完成人机验证后再继续。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await adminApi.login(username, password, turnstileToken ?? undefined);
      window.location.assign("/admin");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "管理员登录失败。");
      setTurnstileToken(null);
      setTurnstileResetKey((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background text-foreground px-4 py-12">
      <section className="w-full max-w-sm rounded-xl border border-surface-border bg-surface p-6 shadow-sm">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-accent">管理员认证</span>
            <h1 className="mt-1 text-lg font-semibold tracking-tight text-foreground">登录控制台</h1>
            <p className="mt-0.5 text-xs text-foreground-muted">请使用具备 ADMIN 权限的管理员账号访问。</p>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5" htmlFor="admin-username">
                用户名
              </label>
              <input
                id="admin-username"
                className="w-full h-9 px-3 rounded-md bg-surface-elevated border border-surface-border text-sm text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5" htmlFor="admin-password">
                密码
              </label>
              <input
                id="admin-password"
                className="w-full h-9 px-3 rounded-md bg-surface-elevated border border-surface-border text-sm text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          {turnstileEnabled ? (
            <TurnstileWidget
              key={turnstileResetKey}
              siteKey={turnstileSiteKey}
              onToken={setTurnstileToken}
              onError={() => setTurnstileToken(null)}
            />
          ) : null}

          {error ? (
            <p className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded px-2.5 py-2 leading-relaxed">
              {error}
            </p>
          ) : null}

          <button
            className="mt-1 w-full h-9 flex items-center justify-center gap-1.5 rounded-md bg-accent text-white hover:bg-accent-hover text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-wait"
            type="submit"
            disabled={busy}
          >
            {busy ? "验证中..." : "进入控制台"}
            <span aria-hidden="true">→</span>
          </button>
        </form>
      </section>
    </main>
  );
}

function TurnstileWidget({
  siteKey,
  onToken,
  onError
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  onError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    if (!scriptReady || !containerRef.current || !window.turnstile) return;
    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action: "auth",
        theme: "dark",
        callback: onToken,
        "expired-callback": () => onToken(null),
        "error-callback": onError
      });
    } catch {
      onError();
    }
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [onError, onToken, scriptReady, siteKey]);

  return (
    <div className="min-h-[65px] overflow-hidden" data-testid="admin-turnstile">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div ref={containerRef} />
    </div>
  );
}
