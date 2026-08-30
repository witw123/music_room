"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type {
  NeteaseTrackCandidate,
  QqMusicTrackCandidate,
  RoomRequest,
  TrackMeta
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/domain/music-room-ui";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { LibraryTabPanel } from "./LibraryTabPanel";
import { LocalStorageTabPanel } from "./LocalStorageTabPanel";
import { MembersPanel } from "./MembersPanel";
import { RoomProviderTrackSearch } from "./RoomProviderTrackSearch";
import { RoomStage } from "./RoomStage";
import { RoomReactionToolbar } from "./RoomReactionToolbar";
import { buildRoomStageProps, type RoomDashboardViewProps } from "./RoomDashboardView";
import { MusicIcon, RadioIcon, UsersIcon } from "@/components/icons/DiscoverIcons";

type ProviderCandidate = NeteaseTrackCandidate | QqMusicTrackCandidate;

export function RequestRoomView(props: RoomDashboardViewProps) {
  const roomId = props.roomSnapshot.room.id;
  const isHost = props.roomSnapshot.room.hostId === props.activeSession?.userId;
  const snapshotRef = useRef(props.roomSnapshot);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [membershipNow, setMembershipNow] = useState(() => Date.now());
  const [mobileWorkspaceTab, setMobileWorkspaceTab] = useState<RequestWorkspaceTab>("library");

  useEffect(() => {
    snapshotRef.current = props.roomSnapshot;
  }, [props.roomSnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => setMembershipNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const requests = useMemo(
    () => props.roomSnapshot.room.requests ?? [],
    [props.roomSnapshot.room.requests]
  );
  const myRequests = useMemo(
    () => requests.filter((request) => request.requesterId === props.activeSession?.userId),
    [props.activeSession?.userId, requests]
  );
  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === "pending"),
    [requests]
  );
  const handledRequests = useMemo(
    () => requests.filter((request) => request.status !== "pending").slice().reverse(),
    [requests]
  );

  const decideRequest = async (
    request: RoomRequest,
    decision: "approved" | "rejected",
    options?: { playNext?: boolean }
  ) => {
    if (pendingRequestId) return;
    setPendingRequestId(request.id);
    setMessage(null);
    try {
      if (decision === "rejected") {
        await musicRoomApi.rejectRoomRequest(roomId, request.id);
        setMessage(`已拒绝《${request.title}》。`);
        return;
      }

      snapshotRef.current = await musicRoomApi.getRoom(roomId);
      const track = await importRequestedTrack(request, props, snapshotRef);
      snapshotRef.current = await musicRoomApi.getRoom(roomId);
      let queuedId = snapshotRef.current.queue.find((item) => item.trackId === track.id)?.id;
      if (!queuedId) {
        const queuedItem = await props.onAddToQueue(track.id);
        if (!queuedItem) {
          throw new Error("歌曲未能加入共享队列，点歌仍保持待审核。请检查房主权限或稍后重试。");
        }
        queuedId = (queuedItem as { id?: string })?.id;
      }
      await musicRoomApi.approveRoomRequest(roomId, request.id);

      if (options?.playNext && queuedId) {
        await props.onPlayNextQueueItem(queuedId);
        setMessage(`《${request.title}》已批准并设为下一首播放。`);
      } else {
        setMessage(`《${request.title}》已加入共享队列。`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "处理点歌失败，请稍后重试。");
    } finally {
      setPendingRequestId(null);
    }
  };

  const handleApproveAll = async () => {
    if (pendingRequestId || pendingRequests.length === 0) return;
    setPendingRequestId("batch:all");
    setMessage(null);
    try {
      let count = 0;
      for (const request of pendingRequests) {
        try {
          snapshotRef.current = await musicRoomApi.getRoom(roomId);
          const track = await importRequestedTrack(request, props, snapshotRef);
          snapshotRef.current = await musicRoomApi.getRoom(roomId);
          const alreadyQueued = snapshotRef.current.queue.some((item) => item.trackId === track.id);
          if (!alreadyQueued) {
            await props.onAddToQueue(track.id);
          }
          await musicRoomApi.approveRoomRequest(roomId, request.id);
          count += 1;
        } catch {
          // Continue with subsequent items in batch
        }
      }
      setMessage(`已批量接纳 ${count} 首点歌。`);
    } finally {
      setPendingRequestId(null);
    }
  };

  const submitRequest = async (track: ProviderCandidate) => {
    setMessage(null);
    const request = await musicRoomApi.createRoomRequest(roomId, {
      provider: track.provider,
      providerTrackId: track.providerTrackId,
      title: track.title,
      artist: track.artist,
      album: track.album ?? null,
      durationMs: track.durationMs,
      artworkUrl: track.artworkUrl ?? null
    });
    if (isHost) {
      await decideRequest(request, "approved");
      return;
    }
    setMessage(`《${track.title}》已送入房主审核队列。`);
  };

  const queueCount = props.roomSnapshot.queue.length;

  const selectableSongs = useMemo(() => {
    const list: Array<{ id: string; title: string; artist?: string; requesterName?: string | null }> = [];
    if (props.currentTrack) {
      list.push({
        id: props.currentTrack.id,
        title: props.currentTrack.title,
        artist: props.currentTrack.artist,
        requesterName: requests.find((r) => r.title === props.currentTrack?.title || r.id === props.currentTrack?.id)?.requesterName ?? null
      });
    }
    requests.forEach((r) => {
      if (!list.some((s) => s.title === r.title)) {
        list.push({
          id: r.id,
          title: r.title,
          artist: r.artist,
          requesterName: r.requesterName
        });
      }
    });
    return list;
  }, [props.currentTrack, requests]);

  return (
    <div className="hide-scrollbar h-full min-h-0 touch-pan-y overflow-y-auto overscroll-y-contain pb-[var(--room-mobile-bottom-inset)] lg:pb-0" data-room-view="request">
      <section className="mx-auto grid w-full max-w-[1600px] gap-3 px-3 pt-3 lg:h-full lg:min-h-full lg:grid-cols-[minmax(0,1.1fr)_minmax(26rem,0.9fr)] lg:gap-0 lg:px-0 lg:pt-0" data-testid="request-room-hero">
        <div className="relative z-10 hidden lg:block min-h-0 min-w-0 overflow-visible lg:h-full lg:min-h-0 lg:overflow-hidden lg:border-r lg:border-white/[0.06] lg:bg-surface/[0.12]">
          <RoomStage {...buildRoomStageProps(props, { mobileControlsOnly: true })} />
        </div>
        <section className="relative z-0 flex min-h-0 min-w-0 flex-col overflow-visible rounded-3xl border border-white/[0.06] bg-[#0c0e15]/90 lg:h-full lg:overflow-hidden lg:rounded-none lg:border-0">
          <header className="flex shrink-0 items-center justify-between px-4 pb-3.5 pt-4 sm:px-5 sm:pt-5 lg:px-6 border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent/20 text-accent border border-accent/25">
                <MusicIcon className="w-4 h-4" />
              </span>
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">点歌台</h1>
            </div>
            <div className="flex items-center gap-2 text-xs text-foreground-muted">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[11px]">
                <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
                <span>当前队列 {queueCount} 首</span>
              </span>
            </div>
          </header>
          <div className="hide-scrollbar min-h-0 flex-1 px-4 pb-5 sm:px-5 lg:overflow-y-auto lg:px-6">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pt-3">
              {/* Request Room Dedicated Song Interaction Bar */}
              <RoomReactionToolbar
                roomId={roomId}
                socket={props.socket}
                variant="request"
                targetSongs={selectableSongs}
                activeSongId={props.currentTrack?.id}
                className="mb-1"
              />

              {isHost ? (
                <>
                  <RoomProviderTrackSearch
                    mode="request"
                    roomTracks={props.roomSnapshot.tracks}
                    onRequestTrack={submitRequest}
                    testId="request-room-host-search"
                  />
                  <RequestInbox
                    pendingRequestId={pendingRequestId}
                    pendingRequests={pendingRequests}
                    handledRequests={handledRequests}
                    onDecide={decideRequest}
                    onApproveAll={handleApproveAll}
                  />
                </>
              ) : (
                <>
                  <RoomProviderTrackSearch
                    mode="request"
                    roomTracks={props.roomSnapshot.tracks}
                    onRequestTrack={submitRequest}
                    testId="request-room-search"
                  />
                  <RequestHistory
                    queue={props.roomSnapshot.queue}
                    requests={myRequests}
                    title="我的点歌"
                    tracks={props.roomSnapshot.tracks}
                  />
                </>
              )}
              {message ? (
                <p className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-xs sm:text-sm text-white backdrop-blur-md shadow-md" role="status">
                  {message}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      </section>

      <RequestRoomWorkspace
        {...props}
        isHost={isHost}
        membershipNow={membershipNow}
        mobileTab={mobileWorkspaceTab}
        onMobileTabChange={setMobileWorkspaceTab}
      />
    </div>
  );
}

type RequestWorkspaceTab = "library" | "playlists" | "members";

const requestWorkspaceTabs: Array<{ id: RequestWorkspaceTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "library", label: "曲库", icon: MusicIcon },
  { id: "playlists", label: "歌单", icon: RadioIcon },
  { id: "members", label: "成员", icon: UsersIcon }
];

function RequestRoomWorkspace(
  props: RoomDashboardViewProps & {
    isHost: boolean;
    membershipNow: number;
    mobileTab: RequestWorkspaceTab;
    onMobileTabChange: (tab: RequestWorkspaceTab) => void;
  }
) {
  const panelVisibility = (tab: RequestWorkspaceTab) =>
    props.mobileTab === tab ? "flex" : "hidden lg:flex";

  return (
    <section className="mx-auto mt-3 w-full max-w-[1600px] px-3 lg:mt-0 lg:grid lg:h-full lg:min-h-full lg:grid-cols-[minmax(20rem,34fr)_minmax(24rem,42fr)_minmax(18rem,24fr)] lg:border-t lg:border-white/[0.06] lg:px-0" data-testid="request-room-workspace">
      <div className="material-surface-header sticky top-0 z-30 mb-3 px-1 lg:hidden" role="tablist" aria-label="点歌房管理">
        <div className="flex items-center gap-1 rounded-2xl border border-white/[0.06] p-1 bg-[#10121a]/80 backdrop-blur-xl">
          {requestWorkspaceTabs.map((tab) => {
            const isActive = props.mobileTab === tab.id;
            const IconComp = tab.icon;
            return (
              <button
                key={tab.id}
                id={`request-workspace-tab-${tab.id}`}
                aria-controls={`request-workspace-${tab.id}`}
                aria-selected={isActive}
                className={`flex-1 flex min-h-9 items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all duration-150 ${
                  isActive
                    ? "bg-accent text-white shadow-[0_4px_16px_var(--accent-glow)] scale-[1.01]"
                    : "text-foreground-muted hover:text-white hover:bg-white/[0.06]"
                }`}
                onClick={() => props.onMobileTabChange(tab.id)}
                role="tab"
                tabIndex={isActive ? 0 : -1}
                type="button"
              >
                <IconComp className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <section className={`${panelVisibility("library")} min-h-[20rem] sm:min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-3xl bg-background lg:min-h-0 lg:rounded-none lg:border-r lg:border-white/[0.06]`} id="request-workspace-library" role="tabpanel">
        <header className="material-surface-header flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-accent border border-accent/20">
              <MusicIcon className="w-3.5 h-3.5" />
            </span>
            <h2 className="text-sm font-bold text-white tracking-tight">房间曲库</h2>
          </div>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-mono text-foreground-muted">
            {props.roomSnapshot.tracks.length} 首
          </span>
        </header>
        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-5 pt-3 sm:px-4">
          <LibraryTabPanel
            activeSession={props.activeSession}
            canAddToQueue={props.isHost}
            canControlPlayback={props.canControlPlayback}
            canManageAllTracks={props.isHost}
            canManageLibrary={props.isHost}
            localFolderName={props.localStorageSummary.localFolderName}
            localSavedFileHashes={props.localStorageSummary.localSavedFileHashes}
            onAddToQueue={props.onAddToQueue}
            onDeleteTrack={props.onDeleteTrack}
            onFilesSelected={props.onFilesSelected}
            onPlayTrack={props.onPlayTrack}
            onSaveTrackToLocal={props.onSaveTrackToLocal}
            tracks={props.roomSnapshot.tracks}
            uploadedTracks={props.uploadedTracks}
          />
        </div>
      </section>

      <section className={`${panelVisibility("playlists")} min-h-[20rem] sm:min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-3xl bg-background lg:min-h-0 lg:rounded-none lg:border-r lg:border-white/[0.06]`} id="request-workspace-playlists" role="tabpanel">
        <header className="material-surface-header flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-accent border border-accent/20">
              <RadioIcon className="w-3.5 h-3.5" />
            </span>
            <h2 className="text-sm font-bold text-white tracking-tight">歌单管理</h2>
          </div>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-mono text-foreground-muted">
            {props.playlists.length} 个
          </span>
        </header>
        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-5 pt-3 sm:px-4">
          <LocalStorageTabPanel
            activeSession={props.activeSession}
            canManageLibrary={props.isHost}
            hideUnavailableProvidersNotice
            localStorageSummary={props.localStorageSummary}
            onCleanLocalStorage={props.onCleanLocalStorage}
            onDeletePlaylist={props.onDeletePlaylist}
            onImportCachedTrack={props.onImportCachedTrack}
            onImportNeteaseTrack={props.onImportNeteaseTrack}
            onImportNeteaseTracks={props.onImportNeteaseTracks}
            onImportQqMusicTrack={props.onImportQqMusicTrack}
            onImportQqMusicTracks={props.onImportQqMusicTracks}
            onLoadPlaylistIntoRoom={props.onLoadPlaylistIntoRoom}
            onRefreshLocalStorage={props.onRefreshLocalStorage}
            onSavePlaylistFromQueue={props.onSavePlaylistFromQueue}
            onUpdatePlaylistTitle={props.onUpdatePlaylistTitle}
            onUpdatePlaylistTracks={props.onUpdatePlaylistTracks}
            playlists={props.playlists}
            tracks={props.roomSnapshot.tracks}
          />
        </div>
      </section>

      <section className={`${panelVisibility("members")} min-h-[20rem] sm:min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-3xl bg-background lg:min-h-0 lg:rounded-none`} id="request-workspace-members" role="tabpanel">
        <header className="material-surface-header flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-accent border border-accent/20">
              <UsersIcon className="w-3.5 h-3.5" />
            </span>
            <h2 className="text-sm font-bold text-white tracking-tight">房间成员</h2>
          </div>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-mono text-foreground-muted">
            {props.roomSnapshot.room.members.length} 人
          </span>
        </header>
        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-5 pt-3 sm:px-4">
          <MembersPanel
            activeSessionId={props.activeSession?.userId ?? null}
            isHost={props.isHost}
            members={props.roomSnapshot.room.members}
            now={props.membershipNow}
            onRemoveMember={props.onRemoveMember}
            onUpdateMemberPermissions={props.onUpdateMemberPermissions}
          />
        </div>
      </section>
    </section>
  );
}

function RequestInbox({
  pendingRequestId,
  pendingRequests,
  handledRequests,
  onDecide,
  onApproveAll
}: {
  pendingRequestId: string | null;
  pendingRequests: RoomRequest[];
  handledRequests: RoomRequest[];
  onDecide: (request: RoomRequest, decision: "approved" | "rejected", options?: { playNext?: boolean }) => Promise<void>;
  onApproveAll?: () => Promise<void>;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#131622]/90 to-[#0b0d14]/95 backdrop-blur-2xl shadow-xl" data-testid="request-room-inbox">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2">
          <h2 className="font-bold text-white text-sm sm:text-base">待审核点歌</h2>
          {pendingRequests.length > 0 ? (
            <span className="rounded-full bg-amber-400/15 border border-amber-400/30 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
              {pendingRequests.length}
            </span>
          ) : null}
        </div>
        {pendingRequests.length > 1 && onApproveAll ? (
          <Button
            disabled={pendingRequestId !== null}
            onClick={() => void onApproveAll()}
            size="sm"
            type="button"
            className="rounded-xl text-xs bg-accent hover:bg-accent-hover text-white shadow-[0_4px_16px_var(--accent-glow)] transition-all active:scale-95"
          >
            全部接纳入队
          </Button>
        ) : null}
      </div>
      {pendingRequests.length ? (
        <div className="divide-y divide-white/[0.05]">
          {pendingRequests.map((request) => (
            <RequestTicket
              key={request.id}
              request={request}
              pending={pendingRequestId === request.id || pendingRequestId === "batch:all"}
              onDecide={onDecide}
            />
          ))}
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-xs text-foreground-muted">还没有等待审核的点歌。</div>
      )}
      {handledRequests.length ? (
        <div className="border-t border-white/[0.06] px-4 py-3 sm:px-5">
          <p className="text-xs font-bold text-foreground-muted uppercase tracking-wider">最近处理记录</p>
          <div className="mt-2 divide-y divide-white/[0.04]">
            {handledRequests.slice(0, 4).map((request) => (
              <RequestHistoryRow key={request.id} request={request} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RequestTicket({
  request,
  pending,
  onDecide
}: {
  request: RoomRequest;
  pending: boolean;
  onDecide: (request: RoomRequest, decision: "approved" | "rejected", options?: { playNext?: boolean }) => Promise<void>;
}) {
  return (
    <article className="flex min-w-0 items-center gap-3.5 px-4 py-3 sm:px-5 transition-colors hover:bg-white/[0.03]">
      <Artwork artworkUrl={request.artworkUrl} title={request.title} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white" title={request.title}>{request.title}</p>
        <p className="mt-0.5 truncate text-xs text-foreground-muted" title={`${request.artist}${request.album ? ` · ${request.album}` : ""}`}>
          {request.artist}{request.album ? ` · ${request.album}` : ""}
        </p>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-foreground-muted/70">
          <span className="font-medium text-accent">@{request.requesterName}</span>
          <span>·</span>
          <span className="font-mono">{formatDuration(request.durationMs)}</span>
          <span>·</span>
          <span className="capitalize">{request.provider === "netease" ? "网易云" : "QQ 音乐"}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          disabled={pending}
          onClick={() => void onDecide(request, "approved")}
          size="sm"
          type="button"
          className="rounded-xl text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30"
        >
          {pending ? "处理中…" : "接纳入队"}
        </Button>
        <Button
          disabled={pending}
          onClick={() => void onDecide(request, "approved", { playNext: true })}
          size="sm"
          type="button"
          variant="outline"
          className="rounded-xl text-xs hidden sm:inline-flex bg-accent/15 hover:bg-accent/25 text-accent border-accent/30"
          title="优先插播为下一首"
        >
          插播
        </Button>
        <Button
          disabled={pending}
          onClick={() => void onDecide(request, "rejected")}
          size="sm"
          type="button"
          variant="ghost"
          className="rounded-xl text-xs text-foreground-muted hover:text-rose-400 hover:bg-rose-500/10"
        >
          婉拒
        </Button>
      </div>
    </article>
  );
}

function RequestHistory({
  queue = [],
  requests,
  title,
  tracks = []
}: {
  queue?: RoomDashboardViewProps["roomSnapshot"]["queue"];
  requests: RoomRequest[];
  title: string;
  tracks?: TrackMeta[];
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#131622]/90 to-[#0b0d14]/95 backdrop-blur-2xl shadow-xl">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3.5 sm:px-5">
        <h2 className="font-bold text-white text-sm sm:text-base">{title}</h2>
        <span className="text-xs font-mono text-foreground-muted">{requests.length} 次点歌记录</span>
      </div>
      {requests.length ? (
        <div className="divide-y divide-white/[0.05]">
          {requests.slice().reverse().map((request) => {
            let queuePosition: number | null = null;
            if (request.status === "approved" && queue.length > 0) {
              const matchingTrack = tracks.find(
                (t) => t.sourceRef?.provider === request.provider && t.sourceRef.trackId === request.providerTrackId
              );
              if (matchingTrack) {
                const index = queue.findIndex((q) => q.trackId === matchingTrack.id);
                if (index >= 0) queuePosition = index + 1;
              }
            }
            return <RequestHistoryRow key={request.id} request={request} queuePosition={queuePosition} />;
          })}
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-xs text-foreground-muted">还没有提交过点歌。</div>
      )}
    </section>
  );
}

function RequestHistoryRow({
  request,
  queuePosition = null
}: {
  request: RoomRequest;
  queuePosition?: number | null;
}) {
  const statusLabel = request.status === "approved"
    ? queuePosition !== null ? `排在第 ${queuePosition} 位` : "已加入队列"
    : request.status === "rejected"
      ? "未被接纳"
      : "等待审核";

  const statusClass = request.status === "approved"
    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
    : request.status === "rejected"
      ? "bg-rose-500/15 border-rose-500/30 text-rose-300"
      : "bg-amber-500/15 border-amber-500/30 text-amber-300";

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs sm:text-sm font-semibold text-white">{request.title}</p>
        <p className="truncate text-xs text-foreground-muted">{request.artist}</p>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${statusClass}`}>
        {statusLabel}
      </span>
    </div>
  );
}

function Artwork({ artworkUrl, title }: { artworkUrl: string | null; title: string }) {
  if (!artworkUrl) {
    return <span aria-label={title} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] border border-white/[0.08] text-xs text-foreground-muted">♪</span>;
  }
  return <img alt={title} className="h-11 w-11 shrink-0 rounded-xl object-cover border border-white/10 shadow-sm" src={artworkUrl} />;
}

async function importRequestedTrack(
  request: RoomRequest,
  props: RoomDashboardViewProps,
  snapshotRef: MutableRefObject<RoomDashboardViewProps["roomSnapshot"]>
): Promise<TrackMeta> {
  const existingTrack = snapshotRef.current.tracks.find(
    (item) => item.sourceRef?.provider === request.provider && item.sourceRef.trackId === request.providerTrackId
  );
  if (existingTrack) return existingTrack;

  if (request.provider === "netease") {
    await props.onImportNeteaseTrack({
      provider: "netease",
      providerTrackId: request.providerTrackId,
      access: "unknown",
      quality: null,
      title: request.title,
      artist: request.artist,
      album: request.album,
      durationMs: request.durationMs,
      artworkUrl: request.artworkUrl
    });
  } else if (request.provider === "qqmusic") {
    await props.onImportQqMusicTrack({
      provider: "qqmusic",
      providerTrackId: request.providerTrackId,
      access: "unknown",
      quality: null,
      title: request.title,
      artist: request.artist,
      album: request.album,
      durationMs: request.durationMs,
      artworkUrl: request.artworkUrl
    });
  }

  snapshotRef.current = await musicRoomApi.getRoom(props.roomSnapshot.room.id);
  const importedTrack = snapshotRef.current.tracks.find(
    (item) => item.sourceRef?.provider === request.provider && item.sourceRef.trackId === request.providerTrackId
  );
  if (!importedTrack) throw new Error("歌曲导入成功但在房间曲库中未就绪。");
  return importedTrack;
}

