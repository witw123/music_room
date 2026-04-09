"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildAppEntryHref } from "@/lib/client-shell";
import { getClientPlatformFromBrowser } from "@/lib/client-shell-browser";
import { musicRoomApi } from "@/lib/music-room-api";
import { toUserFacingError } from "@/lib/music-room-ui";

type AuthMode = "login" | "register";

export function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientPlatform = getClientPlatformFromBrowser();
  const redirectTo = searchParams.get("redirectTo") ?? buildAppEntryHref(clientPlatform);
  const [mode, setMode] = useState<AuthMode>("login");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerNickname, setRegisterNickname] = useState("");
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
    if (!hydrated || !activeSession) {
      return;
    }

    router.replace(
      (redirectTo.startsWith("/") ? redirectTo : buildAppEntryHref(clientPlatform)) as Route
    );
  }, [activeSession, hydrated, redirectTo, router, clientPlatform]);

  async function handleLogin() {
    if (!loginUsername.trim() || !loginPassword) {
      setStatusMessage("请输入用户名和密码。");
      return;
    }

    try {
      const session = await musicRoomApi.login(loginUsername.trim(), loginPassword);
      setActiveSession(session);
      setStatusMessage(`欢迎回来，${session.nickname}。`);
      router.replace(
        (redirectTo.startsWith("/") ? redirectTo : buildAppEntryHref(clientPlatform)) as Route
      );
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function handleRegister() {
    if (!registerUsername.trim() || !registerPassword || !registerNickname.trim()) {
      setStatusMessage("请完整填写用户名、密码和昵称。");
      return;
    }

    try {
      const session = await musicRoomApi.register(
        registerUsername.trim(),
        registerPassword,
        registerNickname.trim()
      );
      setActiveSession(session);
      setStatusMessage(`账号已创建，欢迎你，${session.nickname}。`);
      router.replace(
        (redirectTo.startsWith("/") ? redirectTo : buildAppEntryHref(clientPlatform)) as Route
      );
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  const statusToneClass =
    statusMessage.includes("失败") || statusMessage.includes("错误")
      ? "text-red-400"
      : "text-accent";

  return (
    <main className="relative flex min-h-screen flex-col bg-[#000000] font-sans selection:bg-accent/30 selection:text-white">
      <TopBar activeSession={null} />

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
                    <span className="text-xs font-medium text-white/50">用户名</span>
                    <input
                      className="w-full rounded-lg border border-white/10 bg-[#111] px-4 py-3 text-sm text-white transition-all placeholder:text-white/20 focus:border-accent focus:outline-none"
                      value={loginUsername}
                      onChange={(event) => setLoginUsername(event.target.value)}
                      placeholder="输入用户名"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-white/50">密码</span>
                    <input
                      className="w-full rounded-lg border border-white/10 bg-[#111] px-4 py-3 text-sm text-white transition-all placeholder:text-white/20 focus:border-accent focus:outline-none"
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

                  <Button
                    size="lg"
                    className="mt-4 h-12 w-full rounded-lg bg-accent text-base font-bold text-white transition-all hover:bg-accent-hover"
                    disabled={!loginUsername.trim() || !loginPassword || isPending}
                    onClick={() => startTransition(() => void handleLogin())}
                    type="button"
                  >
                    {isPending ? "处理中..." : "登录并进入"}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-white/50">用户名</span>
                    <input
                      className="w-full rounded-lg border border-white/10 bg-[#111] px-4 py-3 text-sm text-white transition-all placeholder:text-white/20 focus:border-accent focus:outline-none"
                      value={registerUsername}
                      onChange={(event) => setRegisterUsername(event.target.value)}
                      placeholder="设置登录用户名"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-white/50">密码</span>
                    <input
                      className="w-full rounded-lg border border-white/10 bg-[#111] px-4 py-3 text-sm text-white transition-all placeholder:text-white/20 focus:border-accent focus:outline-none"
                      type="password"
                      value={registerPassword}
                      onChange={(event) => setRegisterPassword(event.target.value)}
                      placeholder="至少 6 位密码"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-white/50">昵称</span>
                    <input
                      className="w-full rounded-lg border border-white/10 bg-[#111] px-4 py-3 text-sm text-white transition-all placeholder:text-white/20 focus:border-accent focus:outline-none"
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

                  <Button
                    size="lg"
                    className="mt-4 h-12 w-full rounded-lg bg-accent text-base font-bold text-white transition-all hover:bg-accent-hover"
                    disabled={
                      !registerUsername.trim() ||
                      !registerPassword ||
                      !registerNickname.trim() ||
                      isPending
                    }
                    onClick={() => startTransition(() => void handleRegister())}
                    type="button"
                  >
                    {isPending ? "处理中..." : "注册并进入"}
                  </Button>
                </div>
              )}

              <div className="mt-8 border-t border-white/5 pt-8 text-center">
                <p className="text-xs text-white/40">
                  {mode === "login" ? "还没有账号？" : "已有账号？"}
                  <button
                    className="ml-2 font-medium text-white transition-colors hover:text-accent"
                    onClick={() => setMode(mode === "login" ? "register" : "login")}
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
