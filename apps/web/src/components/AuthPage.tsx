"use client";

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
      ? "密码格式不对，请输入 6-256 位密码。"
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
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
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
      

      <div className="relative z-10 mx-auto my-auto flex min-h-[80vh] w-full max-w-5xl flex-col items-center justify-center p-6 lg:p-12">
        <div className="relative flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-transparent lg:flex-row">
          <div className="relative flex flex-[1.2] flex-col justify-center border-b border-white/10 bg-[#050505] p-8 lg:border-b-0 lg:border-r lg:p-16">
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

          <div className="flex flex-1 flex-col justify-center bg-[#000000] p-8 lg:p-16">
            <div className="mx-auto w-full max-w-sm">
              <div className="mb-8">
                <h2 className="mb-2 text-2xl font-bold text-white">
                  {mode === "login" ? "登录音乐房" : "创建账号"}
                </h2>
                <p className={`text-xs ${statusMessage ? statusToneClass : "text-white/45"}`}>
                  {statusMessage || (mode === "login" ? "输入账号信息后继续进入房间。" : "创建账号后立即进入音乐房。")}
                </p>
              </div>

              {mode === "login" ? (
                <div className="flex flex-col gap-5">
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-white/50">账号</span>
                    <input
                      data-testid="auth-login-username"
                      className="w-full rounded-lg border border-accent bg-[#111] px-4 py-3 text-sm text-white transition-all placeholder:text-white/20 focus:border-accent focus:outline-none"
                      value={loginUsername}
                      onChange={(event) => setLoginUsername(event.target.value)}
                      placeholder="输入账号"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-white/50">密码</span>
                    <input
                      data-testid="auth-login-password"
                      className="w-full rounded-lg border border-accent bg-[#111] px-4 py-3 text-sm text-white transition-all placeholder:text-white/20 focus:border-accent focus:outline-none"
                      type="password"
                      value={loginPassword}
                      onChange={(event) => setLoginPassword(event.target.value)}
                      placeholder="输入密码"
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && loginUsername.trim() && loginPassword) {
                          startTransition(() => void handleLogin());
                        }
                      }}
                    />
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
                    className="mt-4 h-12 w-full rounded-lg bg-accent text-base font-bold text-white transition-all hover:bg-accent-hover"
                    disabled={
                      !loginUsername.trim() ||
                      !loginPassword ||
                      authSubmitDisabled ||
                      isPending
                    }
                    onClick={() => startTransition(() => void handleLogin())}
                    type="button"
                  >
                    {isPending ? "处理中..." : "登录并进入"}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-white/50">账号</span>
                    <input
                      data-testid="auth-register-username"
                      className="w-full rounded-lg border border-accent bg-[#111] px-4 py-3 text-sm text-white transition-all placeholder:text-white/20 focus:border-accent focus:outline-none"
                      value={registerUsername}
                      onChange={(event) => setRegisterUsername(event.target.value)}
                      placeholder="设置登录账号"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-white/50">密码</span>
                    <input
                      data-testid="auth-register-password"
                      className="w-full rounded-lg border border-accent bg-[#111] px-4 py-3 text-sm text-white transition-all placeholder:text-white/20 focus:border-accent focus:outline-none"
                      type="password"
                      value={registerPassword}
                      onChange={(event) => setRegisterPassword(event.target.value)}
                      placeholder="至少 6 位密码"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-white/50">昵称</span>
                    <input
                      data-testid="auth-register-nickname"
                      className="w-full rounded-lg border border-accent bg-[#111] px-4 py-3 text-sm text-white transition-all placeholder:text-white/20 focus:border-accent focus:outline-none"
                      value={registerNickname}
                      onChange={(event) => setRegisterNickname(event.target.value)}
                      placeholder="房间内显示的名字"
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          registerUsername.trim() &&
                          registerPassword &&
                          registerNickname.trim()
                        ) {
                          startTransition(() => void handleRegister());
                        }
                      }}
                    />
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
                    className="mt-4 h-12 w-full rounded-lg bg-accent text-base font-bold text-white transition-all hover:bg-accent-hover"
                    disabled={
                      !registerUsername.trim() ||
                      !registerPassword ||
                      !registerNickname.trim() ||
                      authSubmitDisabled ||
                      isPending
                    }
                    onClick={() => startTransition(() => void handleRegister())}
                    type="button"
                  >
                    {isPending ? "处理中..." : "注册并进入"}
                  </Button>
                </div>
              )}

              <div className="mt-8 border-t border-white/5 pt-8 text-center flex flex-col gap-4">
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
