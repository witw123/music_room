"use client";

import { FormEvent, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import styles from "../admin.module.css";

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
        {error ? <p className={styles.loginError}>{error}</p> : null}
        <button className={styles.loginSubmit} type="submit" disabled={busy}>
          {busy ? "登录中..." : "进入管理控制台"}
          <span aria-hidden="true">→</span>
        </button>
      </form>
    </section>
  </main>;
}
