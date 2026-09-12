"use client";

import Link from "next/link";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { loginRequestSchema, registerRequestSchema } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildAppEntryHref } from "@/lib/domain/client-shell";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { toUserFacingError } from "@/lib/domain/music-room-ui";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          action: string;
          theme: "dark";
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": () => void;
        }
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

type AuthMode = "login" | "register";

function getAuthFormatError(
  mode: AuthMode,
  input: { username: string; password: string; nickname?: string }
) {
  const result = mode === "login"
    ? loginRequestSchema.safeParse({ username: input.username, password: input.password })
    : registerRequestSchema.safeParse({
        username: input.username,
        password: input.password,
        nickname: input.nickname
      });

  if (result.success) return null;

  const field = result.error.issues[0]?.path[0];
  if (field === "username") {
    return "账号格式不对，请输入 1-64 位英文字母、数字、下划线、点或短横线。";
  }
  if (field === "password") {
    return mode === "register"
      ? "密码格式不对，请输入 8-256 位密码。"
      : "密码格式不对，请输入不超过 256 位的密码。";
  }
  if (field === "nickname") {
    return "昵称格式不对，请输入 1-80 个字符。";
  }
  return "账号信息格式不对，请检查后重试。";
}

export function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? buildAppEntryHref();
  const [mode, setMode] = useState<AuthMode>("login");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [registerNickname, setRegisterNickname] = useState("");
  const [authConfig, setAuthConfig] = useState<{ enabled: boolean; siteKey: string } | null>(null);
  const [authConfigError, setAuthConfigError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [isPending, startTransition] = useTransition();
  const {
    activeSession,
    hydrated,
    statusMessage,
    setStatusMessage,
    setActiveSession
  } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });

  useEffect(() => {
    let cancelled = false;
    void musicRoomApi
      .getAuthConfig()
      .then((config) => {
        if (cancelled) return;
        setAuthConfig(config);
        setAuthConfigError("");
      })
      .catch(() => {
        if (cancelled) return;
        setAuthConfigError("安全验证配置加载失败，请刷新页面后重试。");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !activeSession) {
      return;
    }

    router.replace(
      (redirectTo.startsWith("/") ? redirectTo : buildAppEntryHref()) as Route
    );
  }, [activeSession, hydrated, redirectTo, router]);

  async function handleLogin() {
    if (!loginUsername.trim() || !loginPassword) {
      setStatusMessage("请输入账号和密码。");
      return;
    }

    const formatError = getAuthFormatError("login", {
      username: loginUsername,
      password: loginPassword
    });
    if (formatError) {
      setStatusMessage(formatError);
      return;
    }

    if (!canSubmitAuth()) {
      return;
    }

    try {
      const session = await musicRoomApi.login(
        loginUsername.trim(),
        loginPassword,
        turnstileToken ?? undefined
      );
      setActiveSession(session);
      setStatusMessage(`欢迎回来，${session.nickname}。`);
      router.replace(
        (redirectTo.startsWith("/") ? redirectTo : buildAppEntryHref()) as Route
      );
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
      resetTurnstile();
    }
  }

  async function handleRegister() {
    if (!registerUsername.trim() || !registerPassword || !registerNickname.trim()) {
      setStatusMessage("请完整填写账号、密码和昵称。");
      return;
    }

    const formatError = getAuthFormatError("register", {
      username: registerUsername,
      password: registerPassword,
      nickname: registerNickname
    });
    if (formatError) {
      setStatusMessage(formatError);
      return;
    }

    if (!canSubmitAuth()) {
      return;
    }

    try {
      const session = await musicRoomApi.register(
        registerUsername.trim(),
        registerPassword,
        registerNickname.trim(),
        turnstileToken ?? undefined
      );
      setActiveSession(session);
      setStatusMessage(`账号已创建，欢迎你，${session.nickname}。`);
      router.replace(
        (redirectTo.startsWith("/") ? redirectTo : buildAppEntryHref()) as Route
      );
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
      resetTurnstile();
    }
  }

  function resetTurnstile() {
    setTurnstileToken(null);
    setTurnstileResetKey((value) => value + 1);
  }

  function canSubmitAuth() {
    if (authConfigError) {
      setStatusMessage(authConfigError);
      return false;
    }
    if (!authConfig) {
      setStatusMessage("正在加载安全验证，请稍候。");
      return false;
    }
    if (authConfig.enabled && !turnstileToken) {
      setStatusMessage("请完成人机验证后再继续。");
      return false;
    }
    return true;
  }

  const authUnavailable = !authConfig || !!authConfigError;
  const authSubmitDisabled = authUnavailable || (authConfig?.enabled === true && !turnstileToken);
  const turnstileEnabled = authConfig?.enabled === true && !!authConfig.siteKey;
  const handleTurnstileError = useCallback(() => {
    setTurnstileToken(null);
    setStatusMessage("安全验证加载失败，请刷新页面后重试。");
  }, [setStatusMessage]);

  const statusToneClass =
    statusMessage.includes("失败") || statusMessage.includes("错误")
      ? "text-red-400"
      : "text-accent";

  return (
    <main className="relative flex min-h-[100dvh] flex-col bg-[#000000] font-sans selection:bg-accent/30 selection:text-white">
      <div className="relative z-10 mx-auto my-auto flex min-h-[80vh] w-full max-w-5xl flex-col items-center justify-center p-4 sm:p-6 lg:p-12">
        <div className="relative flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#08080a] lg:flex-row">
          {/* Desktop Left Marketing Panel */}
          <div className="relative hidden lg:flex flex-[1.2] flex-col justify-center border-b border-white/10 bg-[#050505] p-8 lg:border-b-0 lg:border-r lg:p-16">
            <div className="relative z-10">
              <span className="mb-6 block text-[10px] font-bold uppercase tracking-[0.2em] text-accent">
                Music Room account
              </span>
              <h1 className="mb-6 text-3xl font-bold text-white">让听歌随心所欲，让共享触手可及</h1>
              <p className="mb-12 text-sm leading-relaxed text-white/50">
                我们致力于满足音乐极客
              </p>

              <div className="flex flex-col gap-6">
                {[
                  { title: "房间", desc: "实时共享，亦可纯享" },
                  { title: "歌单", desc: "互利共赢的歌曲控制" },
                  { title: "记录", desc: "保存你的音乐所想" }
                ].map((item, index) => (
                  <div key={item.title} className="flex items-start gap-4">
                    <span className="mt-0.5 text-sm font-mono font-bold text-accent">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3 className="mb-1 text-sm font-bold text-white">{item.title}</h3>
                      <p className="text-xs text-white/40">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-center bg-[#000000] p-6 sm:p-8 lg:p-16">
            <div className="mx-auto w-full max-w-sm">
              {/* Mobile Back & Brand Header */}
              <div className="flex items-center justify-between mb-6">
                <Link
                  href="/app"
                  className="inline-flex items-center gap-1 text-xs text-white/60 hover:text-white transition-colors py-1.5 px-2.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08]"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  <span>返回</span>
                </Link>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
                  <span className="text-xs font-bold tracking-wider text-white/80 uppercase">Music Room</span>
                </div>
              </div>

              <div className="mb-6">
                <h2 className="mb-1.5 text-xl sm:text-2xl font-bold text-white">
                  {mode === "login" ? "登录音乐房" : "创建账号"}
                </h2>
                <p className={`text-xs ${statusMessage ? statusToneClass : "text-white/45"}`}>
                  {statusMessage || (mode === "login" ? "输入账号信息后继续进入房间。" : "创建账号后立即进入音乐房。")}
                </p>
              </div>

              {mode === "login" ? (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!authSubmitDisabled && !isPending && loginUsername.trim() && loginPassword) {
                      startTransition(() => void handleLogin());
                    }
                  }}
                >
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-white/50">账号</span>
                    <div className="relative flex items-center">
                      <input
                        data-testid="auth-login-username"
                        autoCapitalize="none"
                        autoCorrect="off"
                        autoComplete="username"
                        spellCheck="false"
                        className="w-full rounded-lg border border-white/10 bg-[#111] pl-3.5 pr-10 py-2.5 sm:py-3 text-sm text-white shadow-none outline-none ring-0 placeholder:text-white/20 focus:border-white/20 focus:outline-none focus:ring-0"
                        value={loginUsername}
                        onChange={(event) => setLoginUsername(event.target.value)}
                        placeholder="输入账号"
                      />
                      {loginUsername ? (
                        <button
                          type="button"
                          onClick={() => setLoginUsername("")}
                          className="absolute right-3 p-1 text-white/40 hover:text-white/80 transition-colors"
                          title="清空"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-white/50">密码</span>
                    <div className="relative flex items-center">
                      <input
                        data-testid="auth-login-password"
                        autoCapitalize="none"
                        autoCorrect="off"
                        autoComplete="current-password"
                        spellCheck="false"
                        className="w-full rounded-lg border border-white/10 bg-[#111] pl-3.5 pr-16 py-2.5 sm:py-3 text-sm text-white shadow-none outline-none ring-0 placeholder:text-white/20 focus:border-white/20 focus:outline-none focus:ring-0"
                        type={showLoginPassword ? "text" : "password"}
                        value={loginPassword}
                        onChange={(event) => setLoginPassword(event.target.value)}
                        placeholder="输入密码"
                      />
                      <div className="absolute right-2 flex items-center gap-1">
                        {loginPassword ? (
                          <button
                            type="button"
                            onClick={() => setLoginPassword("")}
                            className="p-1 text-white/40 hover:text-white/80 transition-colors"
                            title="清空"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setShowLoginPassword((v) => !v)}
                          className="p-1 text-white/40 hover:text-white/80 transition-colors"
                          title={showLoginPassword ? "隐藏密码" : "显示密码"}
                        >
                          {showLoginPassword ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  </label>

                  {turnstileEnabled ? (
                    <TurnstileWidget
                      key={turnstileResetKey}
                      siteKey={authConfig?.siteKey ?? ""}
                      onToken={setTurnstileToken}
                      onError={handleTurnstileError}
                    />
                  ) : null}

                  <Button
                    data-testid="auth-login-submit"
                    size="lg"
                    className="mt-2 h-11 sm:h-12 w-full rounded-lg bg-accent text-sm sm:text-base font-bold text-white transition-all hover:bg-accent-hover active:scale-[0.99]"
                    disabled={
                      !loginUsername.trim() ||
                      !loginPassword ||
                      authSubmitDisabled ||
                      isPending
                    }
                    type="submit"
                  >
                    {isPending ? "处理中..." : "登录并进入"}
                  </Button>
                </form>
              ) : (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!authSubmitDisabled && !isPending && registerUsername.trim() && registerPassword && registerNickname.trim()) {
                      startTransition(() => void handleRegister());
                    }
                  }}
                >
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-white/50">账号</span>
                    <div className="relative flex items-center">
                      <input
                        data-testid="auth-register-username"
                        autoCapitalize="none"
                        autoCorrect="off"
                        autoComplete="username"
                        spellCheck="false"
                        className="w-full rounded-lg border border-white/10 bg-[#111] pl-3.5 pr-10 py-2.5 sm:py-3 text-sm text-white shadow-none outline-none ring-0 placeholder:text-white/20 focus:border-white/20 focus:outline-none focus:ring-0"
                        value={registerUsername}
                        onChange={(event) => setRegisterUsername(event.target.value)}
                        placeholder="设置登录账号"
                      />
                      {registerUsername ? (
                        <button
                          type="button"
                          onClick={() => setRegisterUsername("")}
                          className="absolute right-3 p-1 text-white/40 hover:text-white/80 transition-colors"
                          title="清空"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-white/50">密码</span>
                    <div className="relative flex items-center">
                      <input
                        data-testid="auth-register-password"
                        autoCapitalize="none"
                        autoCorrect="off"
                        autoComplete="new-password"
                        spellCheck="false"
                        className="w-full rounded-lg border border-white/10 bg-[#111] pl-3.5 pr-16 py-2.5 sm:py-3 text-sm text-white shadow-none outline-none ring-0 placeholder:text-white/20 focus:border-white/20 focus:outline-none focus:ring-0"
                        type={showRegisterPassword ? "text" : "password"}
                        value={registerPassword}
                        onChange={(event) => setRegisterPassword(event.target.value)}
                        placeholder="至少 8 位密码"
                      />
                      <div className="absolute right-2 flex items-center gap-1">
                        {registerPassword ? (
                          <button
                            type="button"
                            onClick={() => setRegisterPassword("")}
                            className="p-1 text-white/40 hover:text-white/80 transition-colors"
                            title="清空"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setShowRegisterPassword((v) => !v)}
                          className="p-1 text-white/40 hover:text-white/80 transition-colors"
                          title={showRegisterPassword ? "隐藏密码" : "显示密码"}
                        >
                          {showRegisterPassword ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-white/50">昵称</span>
                    <div className="relative flex items-center">
                      <input
                        data-testid="auth-register-nickname"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck="false"
                        className="w-full rounded-lg border border-white/10 bg-[#111] pl-3.5 pr-10 py-2.5 sm:py-3 text-sm text-white shadow-none outline-none ring-0 placeholder:text-white/20 focus:border-white/20 focus:outline-none focus:ring-0"
                        value={registerNickname}
                        onChange={(event) => setRegisterNickname(event.target.value)}
                        placeholder="房间内显示的名字"
                      />
                      {registerNickname ? (
                        <button
                          type="button"
                          onClick={() => setRegisterNickname("")}
                          className="absolute right-3 p-1 text-white/40 hover:text-white/80 transition-colors"
                          title="清空"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  </label>

                  {turnstileEnabled ? (
                    <TurnstileWidget
                      key={turnstileResetKey}
                      siteKey={authConfig?.siteKey ?? ""}
                      onToken={setTurnstileToken}
                      onError={handleTurnstileError}
                    />
                  ) : null}

                  <Button
                    data-testid="auth-register-submit"
                    size="lg"
                    className="mt-2 h-11 sm:h-12 w-full rounded-lg bg-accent text-sm sm:text-base font-bold text-white transition-all hover:bg-accent-hover active:scale-[0.99]"
                    disabled={
                      !registerUsername.trim() ||
                      !registerPassword ||
                      !registerNickname.trim() ||
                      authSubmitDisabled ||
                      isPending
                    }
                    type="submit"
                  >
                    {isPending ? "处理中..." : "注册并进入"}
                  </Button>
                </form>
              )}

              <div className="mt-6 border-t border-white/5 pt-6 text-center flex flex-col gap-3">
                <p className="text-xs text-white/40">
                  {mode === "login" ? "还没有账号？" : "已有账号？"}
                  <button
                    data-testid="auth-mode-toggle"
                    className="ml-2 font-medium text-white transition-colors hover:text-accent"
                    onClick={() => {
                      setMode(mode === "login" ? "register" : "login");
                      resetTurnstile();
                      setStatusMessage("");
                    }}
                    type="button"
                  >
                    {mode === "login" ? "去注册" : "去登录"}
                  </button>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
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
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);
  const [scriptReady, setScriptReady] = useState(false);

  onTokenRef.current = onToken;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!scriptReady || !containerRef.current || !window.turnstile) {
      return;
    }

    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action: "auth",
        theme: "dark",
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onErrorRef.current()
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
  }, [onError, scriptReady, siteKey]);

  return (
    <div className="min-h-[65px] overflow-hidden" data-testid="auth-turnstile">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div ref={containerRef} />
    </div>
  );
}
