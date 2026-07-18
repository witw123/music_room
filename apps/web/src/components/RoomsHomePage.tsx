"use client";

import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { RoomSnapshot } from "@music-room/shared";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildAppEntryHref, buildWorkspaceAuthHref } from "@/lib/client-shell";
import { musicRoomApi } from "@/lib/music-room-api";
import { getOnlineMemberCount, toUserFacingError } from "@/lib/music-room-ui";
import { storeRoomSnapshotHandoff } from "@/lib/room-snapshot-handoff";
import { Button } from "@/components/ui/button";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import { filterRoomsForSession } from "@/features/room/room-list-visibility";

const lastRoomStorageKey = "music-room-last-room";

type CreateRoomForm = {
  visibility: "public" | "private";
  name: string;
  description: string;
  password: string;
};

const emptyCreateRoomForm: CreateRoomForm = {
  visibility: "public",
  name: "",
  description: "",
  password: ""
};

export function RoomsHomePage() {
  const router = useRouter();
  const workspaceEntryHref = buildAppEntryHref();
  const buildRoomHref = (roomId: string) => `/room/${roomId}`;
  const authEntryHref = buildWorkspaceAuthHref({
    redirectTo: workspaceEntryHref
  });
  const [joinCode, setJoinCode] = useState("");
  const [availableRooms, setAvailableRooms] = useState<RoomSnapshot[]>([]);
  const [recentRooms, setRecentRooms] = useState<RoomSnapshot[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateRoomForm>(emptyCreateRoomForm);
  const [selectedRoom, setSelectedRoom] = useState<RoomSnapshot | null>(null);
  const [joinPassword, setJoinPassword] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const {
    activeSession,
    hydrated,
    statusMessage,
    setStatusMessage,
    clearIdentity,
    refreshSession
  } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (!activeSession) {
      router.replace(authEntryHref as Route);
    }
  }, [activeSession, hydrated, router, authEntryHref]);

  const refreshAvailableRooms = useCallback(async () => {
    try {
      const rooms = await musicRoomApi.listRooms();
      if (activeSession) {
        setAvailableRooms(filterRoomsForSession(rooms, activeSession.userId));
      }
    } catch {
      setAvailableRooms([]);
    }
  }, [activeSession]);

  const refreshRecentRooms = useCallback(async () => {
    try {
      const rooms = await musicRoomApi.getRecentRooms();
      setRecentRooms(rooms);
    } catch {
      setRecentRooms([]);
    }
  }, []);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    void refreshSession();
    void refreshAvailableRooms();
    void refreshRecentRooms();
  }, [activeSession, refreshSession, refreshAvailableRooms, refreshRecentRooms]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const refresh = () => {
      void refreshAvailableRooms();
      void refreshRecentRooms();
    };

    const intervalId = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [activeSession, refreshAvailableRooms, refreshRecentRooms]);

  function openCreateRoom(visibility: "public" | "private") {
    setCreateForm({ ...emptyCreateRoomForm, visibility });
    setDialogError(null);
    setCreateDialogOpen(true);
  }

  async function handleCreateRoom() {
    primeRoomAudioFromUserGesture();
    try {
      const snapshot = await musicRoomApi.createRoom({
        visibility: createForm.visibility,
        name: createForm.name.trim() || undefined,
        description: createForm.description.trim() || undefined,
        password: createForm.password.trim() || undefined
      });
      storeRoomSnapshotHandoff(snapshot);
      window.localStorage.setItem(lastRoomStorageKey, snapshot.room.id);
      router.push(buildRoomHref(snapshot.room.id) as Route);
    } catch (error) {
      setDialogError(toUserFacingError(error));
    }
  }

  async function handleJoinRoom(code: string, password?: string) {
    if (!code.trim()) {
      setStatusMessage("请输入房间码。");
      return;
    }

    primeRoomAudioFromUserGesture();
    try {
      const snapshot = await musicRoomApi.joinRoomByCode(code.trim(), password);
      storeRoomSnapshotHandoff(snapshot);
      window.localStorage.setItem(lastRoomStorageKey, snapshot.room.id);
      router.push(buildRoomHref(snapshot.room.id) as Route);
    } catch (error) {
      if (selectedRoom) {
        setDialogError(toUserFacingError(error));
      } else {
        setStatusMessage(toUserFacingError(error));
      }
    }
  }

  function openRoomDetails(room: RoomSnapshot) {
    setSelectedRoom(room);
    setJoinPassword("");
    setDialogError(null);
  }

  function handleJoinCodeSubmit() {
    const room = availableRooms.find(
      (item) => item.room.joinCode.toUpperCase() === joinCode.trim().toUpperCase()
    );
    if (room) {
      openRoomDetails(room);
      return;
    }
    startTransition(() => void handleJoinRoom(joinCode));
  }

  async function confirmRoomEntry() {
    if (!selectedRoom) return;
    setDialogError(null);
    try {
      await handleJoinRoom(selectedRoom.room.joinCode, joinPassword || undefined);
    } catch (error) {
      setDialogError(toUserFacingError(error));
    }
  }

  async function handleReturnToRecentRoom(room: RoomSnapshot) {
    if (!room) {
      return;
    }

    primeRoomAudioFromUserGesture();
    try {
      const recovered = await musicRoomApi.recoverRoom(room.room.id);
      if (recovered) {
        storeRoomSnapshotHandoff(recovered);
        window.localStorage.setItem(lastRoomStorageKey, recovered.room.id);
        router.push(buildRoomHref(recovered.room.id) as Route);
        return;
      }

      const joined = await musicRoomApi.joinRoomByCode(room.room.joinCode);
      storeRoomSnapshotHandoff(joined);
      window.localStorage.setItem(lastRoomStorageKey, joined.room.id);
      router.push(buildRoomHref(joined.room.id) as Route);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function handleLogout() {
    try {
      await musicRoomApi.logout();
    } catch {
      // Ignore logout network errors and always clear local state.
    }

    clearIdentity();
    router.replace(authEntryHref as Route);
  }

  const visibleRooms = useMemo(
    () => [...availableRooms].sort((left, right) => getOnlineMemberCount(right.room.members) - getOnlineMemberCount(left.room.members)),
    [availableRooms]
  );

  if (!hydrated || !activeSession) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-black pb-24 text-foreground selection:bg-accent/30 selection:text-white">
      <div className="fixed inset-0 -z-10 bg-black">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4.5rem_4.5rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
        <div className="absolute left-0 top-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[600px] w-[600px] translate-x-1/3 translate-y-1/3 rounded-full bg-fuchsia-600/10 blur-[150px]" />
      </div>

      <div className="absolute right-4 top-6 z-20 sm:right-6 lg:right-8">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="font-medium text-white/40 transition-all hover:bg-white/5 hover:text-white"
          >
            退出登录
          </Button>
        </div>
      </div>



      <section className="relative mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-4 py-10 sm:px-6 md:py-14 lg:flex-row lg:gap-16 lg:px-8">
        <div className="z-10 flex flex-1 flex-col items-start justify-center">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.28em] text-accent">Music Room</p>
          <h1 className="mb-4 text-3xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-4xl md:text-5xl lg:text-6xl">
            欢迎回来，
            <br />
            <span className="bg-gradient-to-r from-accent to-fuchsia-400 bg-clip-text text-transparent">
              {activeSession.nickname}
            </span>
          </h1>
          <p className="mb-8 max-w-xl text-sm leading-relaxed text-foreground-muted sm:text-base md:text-lg">
            这里是你的房间列表。创建新房间、输入房间码快速加入，或直接回到最近的协作现场。
          </p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <Button data-testid="create-public-room" size="lg" className="w-full sm:w-auto" onClick={() => openCreateRoom("public")} type="button">
              创建公开房间
            </Button>
            <Button data-testid="create-private-room" variant="outline" size="lg" className="w-full sm:w-auto bg-surface hover:bg-surface-hover border-surface-border" onClick={() => openCreateRoom("private")} type="button">
              创建私密房间
            </Button>
          </div>
        </div>

        <div className="z-10 w-full shrink-0 lg:w-[420px] xl:w-[460px]">
          <div className="glass-panel relative flex flex-col gap-5 overflow-hidden rounded-[28px] p-5 shadow-2xl sm:p-7">
            <div className="pointer-events-none absolute right-0 top-0 h-36 w-36 rounded-full bg-accent/20 blur-[90px]" />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-foreground-muted">
                  Join with code
                </p>
                <h2 className="text-xl font-bold text-foreground sm:text-2xl">输入房间码加入</h2>
              </div>
              <span className="inline-flex max-w-full rounded-full border border-surface-border bg-surface px-3 py-1 text-xs font-medium text-foreground-muted">
                {activeSession.username}
              </span>
            </div>

            <div className="mt-1 flex flex-col gap-3">
              <input
                data-testid="join-code-input"
                className="w-full rounded-2xl border border-surface-border bg-black/40 px-4 py-3 text-base font-mono uppercase text-foreground placeholder:font-sans placeholder:normal-case placeholder:text-foreground-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="输入 6 位房间码"
              />
              <Button
                data-testid="join-code-submit"
                size="lg"
                variant="outline"
                className="w-full bg-white/5 hover:bg-white/10"
                disabled={!joinCode.trim()}
                onClick={handleJoinCodeSubmit}
                type="button"
              >
                直接进入房间
              </Button>

              {statusMessage ? (
                <p data-testid="room-home-status" className="animate-fade-in text-center text-sm text-red-400">{statusMessage}</p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 pb-8 sm:px-6 lg:flex-row lg:gap-10 lg:px-8">
        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[320px]">
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-foreground-muted">
              Recent rooms
            </p>
            <h2 className="text-xl font-bold text-foreground">最近加入的房间</h2>
          </div>

          <div className="glass-panel min-h-[300px] rounded-[28px] p-4 sm:p-6">
            {recentRooms.length ? (
              <div className="grid grid-cols-1 gap-4">
                {recentRooms.map((item) => (
                  <RoomDirectoryCard
                    key={item.room.id}
                    room={item}
                    onOpen={() => {
                      startTransition(() => void handleReturnToRecentRoom(item));
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center py-14 text-center opacity-85">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-surface-border bg-surface text-foreground-muted opacity-60">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <h3 className="mb-2 font-semibold text-foreground">还没有最近加入的房间</h3>
                <p className="max-w-sm text-sm text-foreground-muted">
                  创建或加入房间后，最近加入的房间会显示在这里。
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-foreground-muted">
                All rooms
              </p>
              <h2 className="flex items-center gap-3 text-xl font-bold text-foreground">
                所有房间
                {isPending ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                ) : null}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => startTransition(() => void refreshAvailableRooms())}
              type="button"
            >
              刷新
            </Button>
          </div>

          <div className="glass-panel min-h-[300px] rounded-[28px] p-4 sm:p-6">
            {visibleRooms.length ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleRooms.map((item) => (
                  <RoomDirectoryCard
                    key={item.room.id}
                    room={item}
                    onOpen={() => openRoomDetails(item)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center py-14 text-center opacity-85">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-surface-border bg-surface text-foreground-muted">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                </div>
                <h3 className="mb-2 font-semibold text-foreground">当前没有房间</h3>
                <p className="max-w-sm text-sm text-foreground-muted">
                  你可以先创建一个房间等待其他人加入，或者稍后回来刷新列表。
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {createDialogOpen ? (
        <RoomDialog
          title="创建房间"
          description="设置房间信息后再进入协作空间。名称必填，简介和密码可以留空。"
          onClose={() => setCreateDialogOpen(false)}
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(() => void handleCreateRoom());
            }}
          >
            <div className="flex gap-2 rounded-xl border border-surface-border bg-background/60 p-1" role="tablist" aria-label="房间可见性">
              {(["public", "private"] as const).map((visibility) => (
                <button
                  key={visibility}
                  aria-selected={createForm.visibility === visibility}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${createForm.visibility === visibility ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-hover"}`}
                  onClick={() => setCreateForm((current) => ({ ...current, visibility }))}
                  role="tab"
                  type="button"
                >
                  {visibility === "public" ? "公开房间" : "私密房间"}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-2 text-sm text-foreground">
              房间名称
              <input
                autoFocus
                className="rounded-xl border border-surface-border bg-background px-3 py-2.5 text-sm text-foreground caret-accent outline-none placeholder:text-foreground-muted focus:border-accent focus:ring-1 focus:ring-accent"
                maxLength={120}
                onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：周五夜听"
                required
                value={createForm.name}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-foreground">
              房间简介 <span className="text-xs text-foreground-muted">可选</span>
              <textarea
                className="min-h-20 resize-y rounded-xl border border-surface-border bg-background px-3 py-2.5 text-sm text-foreground caret-accent outline-none placeholder:text-foreground-muted focus:border-accent focus:ring-1 focus:ring-accent"
                maxLength={500}
                onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="告诉大家这个房间适合做什么"
                value={createForm.description}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-foreground">
              房间密码 <span className="text-xs text-foreground-muted">可选，至少 4 位</span>
              <input
                className="rounded-xl border border-surface-border bg-background px-3 py-2.5 text-sm text-foreground caret-accent outline-none placeholder:text-foreground-muted focus:border-accent focus:ring-1 focus:ring-accent"
                maxLength={128}
                minLength={4}
                onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="留空表示无需密码"
                type="password"
                value={createForm.password}
              />
            </label>
            {dialogError ? <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">{dialogError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button disabled={isPending} onClick={() => setCreateDialogOpen(false)} type="button" variant="ghost">取消</Button>
              <Button data-testid="create-room-submit" disabled={isPending || !createForm.name.trim() || (createForm.password.trim().length > 0 && createForm.password.trim().length < 4)} type="submit">
                {isPending ? "创建中…" : "创建并进入"}
              </Button>
            </div>
          </form>
        </RoomDialog>
      ) : null}

      {selectedRoom ? (
        <RoomDialog
          title={selectedRoom.room.name ?? "未命名房间"}
          description={selectedRoom.room.description?.trim() || "进入后可以参与播放、队列和成员协作。"}
          onClose={() => setSelectedRoom(null)}
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-surface-border bg-background/50 p-3 text-sm">
              <div><span className="block text-xs text-foreground-muted">房主</span><span className="mt-1 block text-foreground">{selectedRoom.room.members.find((member) => member.role === "host")?.nickname ?? "未知"}</span></div>
              <div><span className="block text-xs text-foreground-muted">房间码</span><span className="mt-1 block font-mono text-foreground">{selectedRoom.room.joinCode}</span></div>
              <div><span className="block text-xs text-foreground-muted">状态</span><span className="mt-1 block text-foreground">{selectedRoom.room.visibility === "private" ? "私密" : "公开"}</span></div>
              <div><span className="block text-xs text-foreground-muted">在线成员</span><span className="mt-1 block text-foreground">{getOnlineMemberCount(selectedRoom.room.members)} 人</span></div>
            </div>
            {selectedRoom.room.hasPassword ? (
              <label className="flex flex-col gap-2 text-sm text-foreground">
                房间密码
                <input
                  autoFocus
                  className="rounded-xl border border-surface-border bg-background px-3 py-2.5 text-sm text-foreground caret-accent outline-none placeholder:text-foreground-muted focus:border-accent focus:ring-1 focus:ring-accent"
                  onChange={(event) => setJoinPassword(event.target.value)}
                  placeholder="请输入房间密码"
                  type="password"
                  value={joinPassword}
                />
              </label>
            ) : null}
            {dialogError ? <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">{dialogError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button disabled={isPending} onClick={() => setSelectedRoom(null)} type="button" variant="ghost">暂不进入</Button>
              <Button data-testid="room-entry-confirm" disabled={isPending || (selectedRoom.room.hasPassword === true && !joinPassword)} onClick={() => startTransition(() => void confirmRoomEntry())} type="button">
                {isPending ? "进入中…" : "进入房间"}
              </Button>
            </div>
          </div>
        </RoomDialog>
      ) : null}
    </main>
  );
}

function RoomDirectoryCard({
  room,
  onOpen
}: {
  room: RoomSnapshot;
  onOpen: () => void;
}) {
  const host = room.room.members.find((member) => member.role === "host")?.nickname ?? "未知";

  return (
    <article
      className="group flex cursor-pointer flex-col gap-3 rounded-3xl border border-surface-border bg-surface/50 p-5 text-left shadow-md backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-accent/30 hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-md border border-surface-border bg-background/60 px-2 py-1 font-mono text-[11px] font-semibold tracking-[0.12em] text-foreground-muted">
            {room.room.joinCode}
          </span>
          {room.room.hasPassword ? (
            <span className="shrink-0 rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[10px] font-medium text-amber-200">
              有密码
            </span>
          ) : null}
        </div>
        <span className="rounded-full border border-surface-border bg-background/50 px-2 py-1 text-xs font-medium text-foreground-muted">
          {getOnlineMemberCount(room.room.members)} 人在线
        </span>
      </div>
      <div className="mt-0.5">
        <h3 className="truncate font-semibold text-foreground">{room.room.name ?? "未命名房间"}</h3>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-foreground-muted">
          {room.room.description?.trim() || `房主 ${host}`}
        </p>
      </div>
    </article>
  );
}

function primeRoomAudioFromUserGesture() {
  // Start the shared context while the join/create click still carries a
  // transient user activation. The room route may receive a playing snapshot
  // immediately after navigation, before the listener has another gesture.
  void roomAudioOutput.primeOutputs({ localAudio: null });
}

function RoomDialog({
  title,
  description,
  onClose,
  children
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm" onMouseDown={onClose} role="presentation">
      <div
        aria-modal="true"
        className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-surface-border bg-surface p-5 shadow-2xl sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{title}</h2>
            <p className="mt-1.5 text-sm leading-6 text-foreground-muted">{description}</p>
          </div>
          <button aria-label="关闭" className="rounded-lg px-2 py-1 text-xl leading-none text-foreground-muted hover:bg-white/10 hover:text-foreground" onClick={onClose} type="button">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
