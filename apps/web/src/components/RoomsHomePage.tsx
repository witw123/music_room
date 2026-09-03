"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import type { RoomDirectoryItem, RoomType } from "@music-room/shared";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildAppEntryHref, buildWorkspaceAuthHref } from "@/lib/domain/client-shell";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { toUserFacingError } from "@/lib/domain/music-room-ui";
import {
  buildRoomJoinBootstrapSnapshot,
  storeRoomSnapshotHandoff
} from "@/lib/domain/room-snapshot-handoff";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/AppSidebar";
import { AwayRoomReturnButton } from "@/components/AwayRoomReturnButton";
import { RoomDirectoryCard } from "@/components/RoomDirectoryCard";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import { filterRoomsForSession } from "@/features/room/room-list-visibility";
import { getCachedRooms, setCachedRooms } from "@/features/workspace/page-data-cache";
import {
  CreateRoomDialogModal,
  JoinCodeDialogModal,
  SelectedRoomDialogModal,
  roomTypeLabel,
  type CreateRoomForm
} from "@/components/room-home";
import {
  clearAwayRoomId,
  readAwayRoomId,
  requestAwayRoomResume
} from "@/lib/domain/away-room";

const lastRoomStorageKey = "music-room-last-room";

type RoomsHomePageProps = {
  awayRoomId?: string | null;
  hasBottomPlayer?: boolean;
  onResumeAwayRoom?: () => void;
  showSidebar?: boolean;
};

export function RoomsHomePage({
  awayRoomId,
  hasBottomPlayer = false,
  onResumeAwayRoom,
  showSidebar = true
}: RoomsHomePageProps = {}) {
  const router = useRouter();
  const workspaceEntryHref = buildAppEntryHref();
  const buildRoomHref = (roomId: string) => `/room/${roomId}`;
  const authEntryHref = buildWorkspaceAuthHref({
    redirectTo: workspaceEntryHref
  });
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
  const [joinCode, setJoinCode] = useState("");
  const [availableRooms, setAvailableRooms] = useState<RoomDirectoryItem[]>(() =>
    activeSession ? getCachedRooms(activeSession.userId) ?? [] : []
  );
  const [roomsLoaded, setRoomsLoaded] = useState(() =>
    Boolean(activeSession && getCachedRooms(activeSession.userId))
  );
  const [roomTypeFilter, setRoomTypeFilter] = useState<"all" | RoomType>("all");
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createFormVisibility, setCreateFormVisibility] = useState<"public" | "private">("public");
  const [selectedRoom, setSelectedRoom] = useState<RoomDirectoryItem | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [storedAwayRoomId, setStoredAwayRoomId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const joinInFlightRef = useRef(false);
  const effectiveAwayRoomId = awayRoomId ?? storedAwayRoomId;

  useEffect(() => {
    if (awayRoomId !== undefined) {
      setStoredAwayRoomId(awayRoomId);
      return;
    }

    setStoredAwayRoomId(readAwayRoomId());
  }, [awayRoomId]);

  function handleResumeAwayRoom() {
    if (!effectiveAwayRoomId) return;
    if (onResumeAwayRoom) {
      onResumeAwayRoom();
      return;
    }

    requestAwayRoomResume(effectiveAwayRoomId);
    router.push(buildRoomHref(effectiveAwayRoomId) as Route);
  }

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
        const nextRooms = filterRoomsForSession(rooms, activeSession.userId);
        setCachedRooms(activeSession.userId, nextRooms);
        setAvailableRooms(nextRooms);
        setRoomsLoaded(true);
      }
    } catch (error) {
      setRoomsLoaded(true);
      setStatusMessage(toUserFacingError(error));
    }
  }, [activeSession, setStatusMessage]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const cachedRooms = getCachedRooms(activeSession.userId);
    if (cachedRooms) {
      setAvailableRooms(cachedRooms);
      setRoomsLoaded(true);
    }

    void refreshSession();
    void refreshAvailableRooms();
  }, [activeSession, refreshSession, refreshAvailableRooms]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const refresh = () => {
      // Hidden tabs keep this workspace mounted in the route cache; polling
      // from a background tab wastes requests and battery for state the user
      // cannot see until they return (focus/visibilitychange re-fires then).
      if (document.visibilityState === "hidden") return;
      void refreshAvailableRooms();
    };

    const intervalId = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [activeSession, refreshAvailableRooms]);

  function openCreateRoom(visibility: "public" | "private") {
    setCreateFormVisibility(visibility);
    setDialogError(null);
    setCreateDialogOpen(true);
  }

  function openJoinDialog() {
    setDialogError(null);
    setJoinDialogOpen(true);
  }

  async function handleCreateRoom(form: CreateRoomForm) {
    primeRoomAudioFromUserGesture();
    try {
      const snapshot = await musicRoomApi.createRoom({
        visibility: form.visibility,
        name: form.name.trim() || undefined,
        description: form.description.trim() || undefined,
        password: form.password.trim() || undefined,
        roomType: form.roomType,
        ...(form.roomType === "interactive"
          ? { newMemberPermissions: form.newMemberPermissions }
          : {})
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
    // Enter-key submits do not go through the disabled submit button, so a
    // double keypress would otherwise fire two concurrent join requests.
    if (joinInFlightRef.current) return;
    joinInFlightRef.current = true;

    primeRoomAudioFromUserGesture();
    try {
      const joined = await musicRoomApi.joinRoomByCode(code.trim(), password);
      storeRoomSnapshotHandoff(buildRoomJoinBootstrapSnapshot(joined));
      window.localStorage.setItem(lastRoomStorageKey, joined.roomId);
      router.push(buildRoomHref(joined.roomId) as Route);
    } catch (error) {
      if (selectedRoom) {
        setDialogError(toUserFacingError(error));
      } else {
        setStatusMessage(toUserFacingError(error));
      }
    }    finally {
      joinInFlightRef.current = false;
    }
  }

  function openRoomDetails(room: RoomDirectoryItem) {
    if (room.room.id === effectiveAwayRoomId) {
      handleResumeAwayRoom();
      return;
    }
    setSelectedRoom(room);
    setDialogError(null);
  }

  function handleJoinCodeSubmit() {
    const room = availableRooms.find(
      (item) => item.room.joinCode.toUpperCase() === joinCode.trim().toUpperCase()
    );
    if (room) {
      setJoinDialogOpen(false);
      openRoomDetails(room);
      return;
    }
    if (isPending || joinInFlightRef.current) return;
    startTransition(() => void handleJoinRoom(joinCode));
  }

  async function handleLogout() {
    try {
      await musicRoomApi.logout();
    } catch {
      // Ignore logout network errors and always clear local state.
    }

    clearAwayRoomId();
    clearIdentity();
    router.replace(authEntryHref as Route);
  }

  const visibleRooms = useMemo(
    () => availableRooms
      .filter((room) => roomTypeFilter === "all" || room.room.roomType === roomTypeFilter)
      .sort((left, right) =>
      right.room.directoryOnlineMemberCount - left.room.directoryOnlineMemberCount
    ),
    [availableRooms, roomTypeFilter]
  );

  if (!hydrated || !activeSession) {
    return <div className="min-h-[100dvh] bg-background" />;
  }

  return (
    <main className="workspace-page home-workspace-page hide-scrollbar relative flex flex-col overflow-y-auto selection:bg-accent/30 selection:text-white md:pb-[calc(12rem+env(safe-area-inset-bottom))] md:pl-60">

      {showSidebar ? (
        <AppSidebar
          activeItem="home"
          hasBottomPlayer={hasBottomPlayer}
          onLogout={handleLogout}
        />
      ) : null}

      {effectiveAwayRoomId && showSidebar ? <AwayRoomReturnButton onClick={handleResumeAwayRoom} /> : null}


      <section className="workspace-page__inner home-centered-workspace relative flex w-full shrink-0 flex-col gap-6 pt-[calc(1rem+env(safe-area-inset-top))] md:gap-6">
        <header className="workspace-page__header flex items-center justify-between md:hidden">
          <div>
            <p className="workspace-page__eyebrow">一起听见此刻</p>
            <h1 className="workspace-page__title">主页</h1>
          </div>
          <Link aria-label="打开个人中心" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-surface-border bg-background-secondary shadow-sm transition-transform duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" href="/app/profile">
            <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><circle cx="12" cy="8" r="3.5" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></svg>
          </Link>
        </header>

        <div className="flex flex-col gap-3 md:hidden">
          <div className="flex items-center gap-2">
            <Button data-testid="create-public-room-mobile" size="sm" onClick={() => openCreateRoom("public")} type="button">
              创建房间
            </Button>
            <button
              aria-label="刷新房间列表"
              className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground-muted transition-[transform,background-color,color] duration-200 hover:bg-surface hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={() => startTransition(() => void refreshAvailableRooms())}
              title="刷新房间列表"
              type="button"
            >
              <svg aria-hidden="true" className={isPending ? "animate-spin" : ""} fill="none" height="19" viewBox="0 0 24 24" width="19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="M20 11a8 8 0 1 0 2 5.5" /><path d="M20 4v7h-7" /></svg>
            </button>
          </div>

          <form
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              handleJoinCodeSubmit();
            }}
          >
            <label className="sr-only" htmlFor="mobile-join-code-input">输入房间码</label>
            <input
              aria-label="输入房间码"
              className="min-w-0 rounded-xl border border-surface-border bg-background-secondary px-3 py-2.5 font-mono text-sm uppercase text-foreground outline-none placeholder:font-sans placeholder:normal-case placeholder:text-foreground-muted focus:border-accent focus:ring-1 focus:ring-accent"
              data-testid="mobile-join-code-input"
              id="mobile-join-code-input"
              maxLength={6}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder="输入 6 位房间码"
              value={joinCode}
            />
            <Button data-testid="mobile-join-code-submit" disabled={!joinCode.trim() || isPending} type="submit" variant="outline">
              {isPending ? "加入中…" : "加入"}
            </Button>
          </form>
        </div>

        <div className="hidden items-center justify-between gap-4 md:flex">
          <div className="flex items-center gap-1 rounded-2xl border border-white/[0.06] p-1 bg-[#10121a]/80 backdrop-blur-2xl" role="tablist" aria-label="房间类型筛选">
            {(["all", "interactive", "request", "radio"] as const).map((roomType) => {
              const isSelected = roomTypeFilter === roomType;
              return (
                <button
                  aria-selected={isSelected}
                  className={`flex min-h-9 whitespace-nowrap items-center justify-center rounded-xl px-4 py-1.5 text-xs sm:text-sm font-semibold transition-all duration-150 ${
                    isSelected
                      ? "bg-accent text-white shadow-[0_4px_16px_var(--accent-glow)] scale-[1.01]"
                      : "text-foreground-muted hover:text-white hover:bg-white/[0.06]"
                  }`}
                  key={roomType}
                  onClick={() => setRoomTypeFilter(roomType)}
                  role="tab"
                  type="button"
                >
                  {roomType === "all" ? "全部" : roomTypeLabel(roomType)}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <Button
              data-testid="create-public-room"
              size="sm"
              className="rounded-xl px-4 text-xs sm:text-sm font-semibold bg-accent hover:bg-accent-hover text-white shadow-[0_4px_20px_var(--accent-glow)] transition-all active:scale-95"
              onClick={() => openCreateRoom("public")}
              type="button"
            >
              创建公开房间
            </Button>
            <Button
              data-testid="create-private-room"
              variant="outline"
              size="sm"
              className="rounded-xl border border-white/[0.08] bg-white/[0.05] hover:bg-white/[0.10] text-white text-xs sm:text-sm font-medium transition-all"
              onClick={() => openCreateRoom("private")}
              type="button"
            >
              创建私密房间
            </Button>
            <Button
              data-testid="open-join-room-dialog"
              variant="outline"
              size="sm"
              className="rounded-xl border border-white/[0.08] bg-white/[0.05] hover:bg-white/[0.10] text-white text-xs sm:text-sm font-medium transition-all"
              onClick={openJoinDialog}
              type="button"
            >
              输入房间码加入
            </Button>
            <Button
              aria-label="刷新房间列表"
              variant="ghost"
              size="sm"
              className="rounded-xl text-foreground-muted hover:text-white hover:bg-white/[0.06] text-xs sm:text-sm transition-all"
              onClick={() => startTransition(() => void refreshAvailableRooms())}
              type="button"
            >
              刷新
            </Button>
          </div>
        </div>

        <div className="rounded-3xl border border-white/[0.06] bg-gradient-to-b from-[#12141c]/40 to-[#0c0e15]/60 p-4 lg:p-6 backdrop-blur-2xl min-h-[300px] shadow-2xl">
          <div className="mb-4 flex justify-center md:hidden">
            <div className="flex w-full items-center gap-1 rounded-2xl border border-white/[0.06] p-1 bg-[#10121a]/80" role="tablist" aria-label="房间类型筛选">
              {(["all", "interactive", "request", "radio"] as const).map((roomType) => {
                const isSelected = roomTypeFilter === roomType;
                return (
                  <button
                    aria-selected={isSelected}
                    className={`flex-1 flex min-h-9 whitespace-nowrap items-center justify-center rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-all ${
                      isSelected
                        ? "bg-accent text-white shadow-[0_4px_16px_var(--accent-glow)]"
                        : "text-foreground-muted hover:text-white"
                    }`}
                    key={roomType}
                    onClick={() => setRoomTypeFilter(roomType)}
                    role="tab"
                    type="button"
                  >
                    {roomType === "all" ? "全部" : roomTypeLabel(roomType)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mb-4 flex items-center justify-between md:hidden">
            <h2 className="text-base font-bold text-white tracking-tight">全部房间</h2>
            <span className="text-xs text-foreground-muted">{visibleRooms.length} 个</span>
          </div>
          {visibleRooms.length ? (
            <div className="grid w-full grid-cols-1 justify-center gap-4 md:grid-cols-[repeat(auto-fit,18rem)] xl:gap-5">
              {visibleRooms.map((item) => (
                <RoomDirectoryCard
                  key={item.room.id}
                  room={item}
                  onOpen={() => openRoomDetails(item)}
                />
              ))}
            </div>
          ) : !roomsLoaded ? (
            <div className="flex min-h-[260px] items-center justify-center py-14 text-center text-sm text-foreground-muted">
              正在加载房间…
            </div>
          ) : (
            <div className="flex min-h-[260px] flex-col items-center justify-center py-14 text-center opacity-85">
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
      </section>

      {createDialogOpen ? (
        <CreateRoomDialogModal
          defaultRoomName={activeSession?.nickname ? `${activeSession.nickname}的音乐房间` : "音乐房间"}
          dialogError={dialogError}
          initialVisibility={createFormVisibility}
          isPending={isPending}
          onClose={() => setCreateDialogOpen(false)}
          onSubmit={(form) => {
            startTransition(() => void handleCreateRoom(form));
          }}
        />
      ) : null}

      {joinDialogOpen ? (
        <JoinCodeDialogModal
          isPending={isPending}
          onClose={() => setJoinDialogOpen(false)}
          onSubmit={(code) => {
            const room = availableRooms.find(
              (item) => item.room.joinCode.toUpperCase() === code.trim().toUpperCase()
            );
            if (room) {
              setJoinDialogOpen(false);
              openRoomDetails(room);
              return;
            }
            if (isPending || joinInFlightRef.current) return;
            startTransition(() => void handleJoinRoom(code));
          }}
          statusMessage={statusMessage}
        />
      ) : null}

      {selectedRoom ? (
        <SelectedRoomDialogModal
          dialogError={dialogError}
          isPending={isPending}
          onClose={() => setSelectedRoom(null)}
          onConfirm={(password) => {
            setDialogError(null);
            startTransition(async () => {
              try {
                await handleJoinRoom(selectedRoom.room.joinCode, password || undefined);
              } catch (error) {
                setDialogError(toUserFacingError(error));
              }
            });
          }}
          room={selectedRoom}
        />
      ) : null}
    </main>
  );
}

function primeRoomAudioFromUserGesture() {
  // Start the shared context while the join/create click still carries a
  // transient user activation. The room route may receive a playing snapshot
  // immediately after navigation, before the listener has another gesture.
  void roomAudioOutput.primeOutputs({ localAudio: null });
}

