"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { adminApi } from "@/lib/admin-api";
import { musicRoomApi } from "@/lib/music-room-api";
import styles from "../admin.module.css";

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

  return <main className={styles.loginShell}>
    <section className={styles.loginPanel}>
      <form className={styles.loginForm} onSubmit={submit}>
        <div className={styles.eyebrow}>管理员登录</div>
        <h1 className={styles.loginTitle}>登录管理控制台</h1>
        <p className={styles.loginHint}>请使用已启用的管理员账号访问控制台。</p>
        <div className={styles.loginFields}>
          <label className={styles.loginLabel}>
            用户名
            <input className={styles.loginInput} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
          </label>
          <label className={styles.loginLabel}>
            密码
            <input className={styles.loginInput} value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
          </label>
        </div>
        {turnstileEnabled ? (
          <TurnstileWidget
            key={turnstileResetKey}
            siteKey={turnstileSiteKey}
            onToken={setTurnstileToken}
            onError={() => setTurnstileToken(null)}
          />
        ) : null}
        {error ? <p className={styles.loginError}>{error}</p> : null}
        <button className={styles.loginSubmit} type="submit" disabled={busy}>
          {busy ? "登录中..." : "进入管理控制台"}
          <span aria-hidden="true">→</span>
        </button>
      </form>
    </section>
  </main>;
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

  return <div className="min-h-[65px] overflow-hidden" data-testid="admin-turnstile">
    <Script
      src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      strategy="afterInteractive"
      onReady={() => setScriptReady(true)}
    />
    <div ref={containerRef} />
  </div>;
}
