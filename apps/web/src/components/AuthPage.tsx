"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { musicRoomApi } from "@/lib/music-room-api";
import { toUserFacingError } from "@/lib/music-room-ui";

type AuthMode = "login" | "register";

export function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/rooms";
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
    initialStatusMessage: "登录后即可创建房间、加入房间，并恢复最近的音乐房。"
  });

  useEffect(() => {
    if (!hydrated || !activeSession) {
      return;
    }

    router.replace((redirectTo.startsWith("/") ? redirectTo : "/rooms") as Route);
  }, [activeSession, hydrated, redirectTo, router]);

  async function handleLogin() {
    if (!loginUsername.trim() || !loginPassword) {
      setStatusMessage("请输入用户名和密码。");
      return;
    }

    try {
      const session = await musicRoomApi.login(loginUsername.trim(), loginPassword);
      setActiveSession(session);
      setStatusMessage(`欢迎回来，${session.nickname}。`);
      router.replace((redirectTo.startsWith("/") ? redirectTo : "/rooms") as Route);
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
      router.replace((redirectTo.startsWith("/") ? redirectTo : "/rooms") as Route);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  return (
    <main className="min-h-screen bg-[#000000] relative flex flex-col font-sans selection:bg-accent/30 selection:text-white">
      <TopBar />

      <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12 animate-fade-in relative z-10 w-full max-w-5xl mx-auto my-auto min-h-[80vh]">
        <div className="flex flex-col lg:flex-row w-full bg-transparent border border-white/10 rounded-2xl overflow-hidden relative">
          
          <div className="flex-[1.2] p-8 lg:p-16 flex flex-col justify-center relative border-b lg:border-b-0 lg:border-r border-white/10 bg-[#050505]">
            <div className="relative z-10">
              <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-accent mb-6 block">Music Room account</span>
              <h1 className="text-3xl font-bold text-white mb-6">让协作听歌成为连续路径</h1>
              <p className="text-sm text-white/50 leading-relaxed mb-12">
                统一管理你的房间权限、昵称与历史连线记录。
              </p>
              
              <div className="flex flex-col gap-6">
                {[
                  { title: "创建 / 加入房间", desc: "直接验证身份，不再重复处理弹窗或访客确认。" },
                  { title: "共享队列协作", desc: "当前播放与排队状态实时显示所有人提交的曲目。" },
                  { title: "恢复最近房间", desc: "关闭标签页或是断网后，也能快速回到刚刚的房间。" }
                ].map((item, i) => (
                  <div key={i} className="flex gap-4 items-start">
                    <span className="text-accent text-sm font-mono mt-0.5 font-bold">0{i + 1}</span>
                    <div>
                      <h3 className="text-sm font-bold text-white mb-1">{item.title}</h3>
                      <p className="text-xs text-white/40">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex-1 p-8 lg:p-16 flex flex-col justify-center bg-[#000000]">
            <div className="w-full max-w-sm mx-auto">
              <div className="flex p-1 bg-white/5 border border-white/5 rounded-lg mb-10 w-full max-w-[240px]">
                <button
                  className={`flex-1 text-xs font-semibold py-2 rounded-md transition-all ${mode === "login" ? "bg-[#111] text-white shadow-sm border border-white/10" : "text-white/50 hover:text-white"}`}
                  onClick={() => setMode("login")}
                  type="button"
                >
                  登录
                </button>
                <button
                  className={`flex-1 text-xs font-semibold py-2 rounded-md transition-all ${mode === "register" ? "bg-[#111] text-white shadow-sm border border-white/10" : "text-white/50 hover:text-white"}`}
                  onClick={() => setMode("register")}
                  type="button"
                >
                  注册
                </button>
              </div>

              <div className="mb-8">
                <h2 className="text-2xl font-bold text-white mb-2">{mode === "login" ? "登录音乐房" : "创建账号"}</h2>
                <p className={`text-xs ${statusMessage?.includes("错误") || statusMessage?.includes("失败") ? "text-red-400" : "text-accent"}`}>
                  {statusMessage || "欢迎来到 Music Room。"}
                </p>
              </div>

              {mode === "login" ? (
                <div className="flex flex-col gap-5">
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-white/50">用户名</span>
                    <input
                      className="w-full bg-[#111] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-accent transition-all placeholder:text-white/20"
                      value={loginUsername}
                      onChange={(event) => setLoginUsername(event.target.value)}
                      placeholder="输入用户名"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-white/50">密码</span>
                    <input
                      className="w-full bg-[#111] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-accent transition-all placeholder:text-white/20"
                      type="password"
                      value={loginPassword}
                      onChange={(event) => setLoginPassword(event.target.value)}
                      placeholder="输入密码"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && loginUsername.trim() && loginPassword) {
                          startTransition(() => void handleLogin());
                        }
                      }}
                    />
                  </label>

                  <Button
                    size="lg"
                    className="w-full mt-4 h-12 rounded-lg bg-accent hover:bg-accent-hover text-white text-base font-bold transition-all"
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
                    <span className="text-xs font-medium text-white/50">用户名（用于登录）</span>
                    <input
                      className="w-full bg-[#111] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-accent transition-all placeholder:text-white/20"
                      value={registerUsername}
                      onChange={(event) => setRegisterUsername(event.target.value)}
                      placeholder="例如：jack"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-white/50">密码</span>
                    <input
                      className="w-full bg-[#111] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-accent transition-all placeholder:text-white/20"
                      type="password"
                      value={registerPassword}
                      onChange={(event) => setRegisterPassword(event.target.value)}
                      placeholder="至少 6 位密码"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-white/50">昵称（用于在房间内展示）</span>
                    <input
                      className="w-full bg-[#111] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-accent transition-all placeholder:text-white/20"
                      value={registerNickname}
                      onChange={(event) => setRegisterNickname(event.target.value)}
                      placeholder="例如：Jack Smith"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && registerUsername.trim() && registerPassword && registerNickname.trim()) {
                          startTransition(() => void handleRegister());
                        }
                      }}
                    />
                  </label>

                  <Button
                    size="lg"
                    className="w-full mt-4 h-12 rounded-lg bg-accent hover:bg-accent-hover text-white text-base font-bold transition-all"
                    disabled={!registerUsername.trim() || !registerPassword || !registerNickname.trim() || isPending}
                    onClick={() => startTransition(() => void handleRegister())}
                    type="button"
                  >
                    {isPending ? "处理中..." : "注册并进入"}
                  </Button>
                </div>
              )}

              <div className="mt-8 text-center pt-8 border-t border-white/5">
                <Link href={"/features" as Route} className="text-xs font-medium text-white/40 hover:text-white transition-colors">
                  不确定是否需要？查看功能结构 &rarr;
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
