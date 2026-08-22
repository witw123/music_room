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
import { buildRoomStageProps, type RoomDashboardViewProps } from "./RoomDashboardView";

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

  return <div className="hide-scrollbar h-full min-h-0 touch-pan-y overflow-y-auto overscroll-y-contain pb-[var(--room-mobile-bottom-inset)] lg:pb-0" data-room-view="request">
    <section className="mx-auto grid w-full max-w-[1600px] gap-3 px-3 pt-3 lg:h-full lg:min-h-full lg:grid-cols-[minmax(0,1.1fr)_minmax(26rem,0.9fr)] lg:gap-0 lg:px-0 lg:pt-0" data-testid="request-room-hero">
      <div className="min-h-0 overflow-visible lg:h-full lg:min-h-0 lg:overflow-hidden lg:border-r lg:border-surface-border lg:bg-surface/[0.12]">
        <RoomStage {...buildRoomStageProps(props, { mobileControlsOnly: true })} />
      </div>
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface/[0.12] lg:h-full lg:rounded-none lg:border-0">
        <header className="flex shrink-0 items-center justify-between px-4 pb-3 pt-4 sm:px-5 sm:pt-5 lg:px-6 border-b border-white/[0.04]">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/20 text-accent">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            </span>
            <h1 className="text-xl font-semibold text-foreground">点歌台</h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-foreground-muted">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span>当前队列 {queueCount} 首</span>
            </span>
          </div>
        </header>
        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-5 sm:px-5 lg:px-6">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pt-3">
            {isHost ? <>
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
            </> : <>
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
            </>}
            {message ? <p className="rounded-xl border border-white/10 bg-surface/60 px-4 py-3 text-sm text-foreground backdrop-blur-md shadow-sm" role="status">{message}</p> : null}
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
  </div>;
}

type RequestWorkspaceTab = "library" | "playlists" | "members";

const requestWorkspaceTabs: Array<{ id: RequestWorkspaceTab; label: string }> = [
  { id: "library", label: "曲库" },
  { id: "playlists", label: "歌单" },
  { id: "members", label: "成员" }
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

  return <section className="mx-auto mt-3 w-full max-w-[1600px] px-3 lg:mt-0 lg:grid lg:h-full lg:min-h-full lg:grid-cols-[minmax(20rem,34fr)_minmax(24rem,42fr)_minmax(18rem,24fr)] lg:border-t lg:border-surface-border lg:px-0" data-testid="request-room-workspace">
    <div className="mb-3 grid grid-cols-3 rounded-2xl border border-surface-border bg-surface/[0.12] p-1 lg:hidden" role="tablist" aria-label="点歌房管理">
      {requestWorkspaceTabs.map((tab) => <button
        aria-controls={`request-workspace-${tab.id}`}
        aria-selected={props.mobileTab === tab.id}
        className={`min-h-10 rounded-xl px-3 text-sm font-medium transition-colors ${props.mobileTab === tab.id ? "bg-accent text-white" : "text-foreground-muted"}`}
        key={tab.id}
        onClick={() => props.onMobileTabChange(tab.id)}
        role="tab"
        type="button"
      >{tab.label}</button>)}
    </div>

    <section className={`${panelVisibility("library")} min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-background lg:min-h-0 lg:rounded-none lg:border-y-0 lg:border-l lg:border-r`} id="request-workspace-library" role="tabpanel">
      <header className="shrink-0 px-4 py-4 sm:px-5"><h2 className="text-base font-semibold text-foreground">曲库</h2></header>
      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-5 sm:px-4">
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

    <section className={`${panelVisibility("playlists")} min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-background lg:min-h-0 lg:rounded-none lg:border-y-0 lg:border-l lg:border-r`} id="request-workspace-playlists" role="tabpanel">
      <header className="shrink-0 px-4 py-4 sm:px-5"><h2 className="text-base font-semibold text-foreground">歌单</h2></header>
      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-5 sm:px-4">
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

    <section className={`${panelVisibility("members")} min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-background lg:min-h-0 lg:rounded-none lg:border-0`} id="request-workspace-members" role="tabpanel">
      <header className="shrink-0 px-4 py-4 sm:px-5"><h2 className="text-base font-semibold text-foreground">成员</h2></header>
      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-5 sm:px-4">
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
  </section>;
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
  return <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md shadow-sm" data-testid="request-room-inbox">
    <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold text-foreground">待审核点歌</h2>
        {pendingRequests.length > 0 ? (
          <span className="rounded-full bg-amber-400/15 border border-amber-400/30 px-2 py-0.5 text-[11px] font-bold text-amber-300">
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
          className="rounded-lg text-xs"
        >
          全部接纳
        </Button>
      ) : null}
    </div>
    {pendingRequests.length ? <div className="divide-y divide-white/5">
      {pendingRequests.map((request) => <RequestTicket
        key={request.id}
        request={request}
        pending={pendingRequestId === request.id || pendingRequestId === "batch:all"}
        onDecide={onDecide}
      />)}
    </div> : <div className="px-4 py-8 text-center text-sm text-foreground-muted">还没有等待审核的点歌。</div>}
    {handledRequests.length ? <div className="border-t border-white/[0.06] px-4 py-3 sm:px-5">
      <p className="text-xs font-semibold text-foreground-muted/80">最近处理</p>
      <div className="mt-2 divide-y divide-white/[0.04]">
        {handledRequests.slice(0, 4).map((request) => <RequestHistoryRow key={request.id} request={request} />)}
      </div>
    </div> : null}
  </section>;
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
  return <article className="flex min-w-0 items-center gap-3.5 px-4 py-3.5 sm:px-5 transition-colors hover:bg-white/[0.02]">
    <Artwork artworkUrl={request.artworkUrl} title={request.title} />
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold text-foreground" title={request.title}>{request.title}</p>
      <p className="mt-0.5 truncate text-xs text-foreground-muted" title={`${request.artist}${request.album ? ` · ${request.album}` : ""}`}>
        {request.artist}{request.album ? ` · ${request.album}` : ""}
      </p>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-foreground-muted/70">
        <span className="font-medium text-accent">{request.requesterName}</span>
        <span>·</span>
        <span className="font-mono">{formatDuration(request.durationMs)}</span>
        <span>·</span>
        <span className="capitalize">{request.provider === "netease" ? "网易云" : "QQ 音乐"}</span>
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      <Button
        disabled={pending}
        onClick={() => void onDecide(request, "approved")}
        size="sm"
        type="button"
        className="rounded-lg text-xs"
      >
        {pending ? "处理中…" : "接纳入队"}
      </Button>
      <Button
        disabled={pending}
        onClick={() => void onDecide(request, "approved", { playNext: true })}
        size="sm"
        type="button"
        variant="outline"
        className="rounded-lg text-xs hidden sm:inline-flex"
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
        className="rounded-lg text-xs text-foreground-muted hover:text-danger hover:bg-red-500/10"
      >
        拒绝
      </Button>
    </div>
  </article>;
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
  return <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md shadow-sm">
    <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3.5 sm:px-5">
      <h2 className="font-semibold text-foreground">{title}</h2>
      <span className="text-xs font-mono text-foreground-muted">{requests.length} 次点歌记录</span>
    </div>
    {requests.length ? <div className="divide-y divide-white/5">
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
    </div> : <div className="px-4 py-8 text-center text-sm text-foreground-muted">还没有提交过点歌。</div>}
  </section>;
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

  const statusBadgeClass = request.status === "approved"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : request.status === "rejected"
      ? "border-white/10 bg-white/5 text-foreground-muted/60"
      : "border-amber-400/30 bg-amber-400/10 text-amber-300 animate-pulse";

  return <div className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5 transition-colors hover:bg-white/[0.02]">
    <Artwork artworkUrl={request.artworkUrl} title={request.title} compact />
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs font-semibold text-foreground" title={request.title}>{request.title}</p>
      <p className="mt-0.5 truncate text-[11px] text-foreground-muted" title={request.artist}>{request.artist}</p>
    </div>
    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${statusBadgeClass}`}>
      {statusLabel}
    </span>
  </div>;
}

function Artwork({ artworkUrl, title, compact = false }: { artworkUrl: string | null; title: string; compact?: boolean }) {
  const size = compact ? "h-9 w-9" : "h-12 w-12";
  return artworkUrl ? (
    <img alt="" className={`${size} shrink-0 rounded-lg border border-white/10 object-cover shadow-sm`} src={artworkUrl} />
  ) : (
    <span aria-label={`${title} 无封面`} className={`${size} flex shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-[10px] text-foreground-muted`}>
      音乐
    </span>
  );
}

async function importRequestedTrack(
  request: RoomRequest,
  props: RoomDashboardViewProps,
  snapshotRef: MutableRefObject<RoomDashboardViewProps["roomSnapshot"]>
) {
  const existing = findProviderTrack(snapshotRef.current.tracks, request);
  if (existing) return existing;
  if (request.provider === "netease") {
    const candidate = await musicRoomApi.getNeteaseTrack(request.providerTrackId);
    await props.onImportNeteaseTrack(candidate);
  } else if (request.provider === "qqmusic") {
    const candidate = await musicRoomApi.getQqMusicTrack(request.providerTrackId);
    await props.onImportQqMusicTrack(candidate);
  } else {
    throw new Error("本地点歌需要房主手动导入后再加入队列。");
  }

  snapshotRef.current = await musicRoomApi.getRoom(request.roomId);
  const importedTrack = findProviderTrack(snapshotRef.current.tracks, request);
  if (importedTrack) return importedTrack;

  return waitForImportedTrack(snapshotRef, request);
}

function findProviderTrack(tracks: TrackMeta[], request: RoomRequest) {
  return tracks.find((track) => track.sourceRef?.provider === request.provider && track.sourceRef.trackId === request.providerTrackId) ?? null;
}

async function waitForImportedTrack(
  snapshotRef: MutableRefObject<RoomDashboardViewProps["roomSnapshot"]>,
  request: RoomRequest
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    snapshotRef.current = await musicRoomApi.getRoom(request.roomId);
    const track = findProviderTrack(snapshotRef.current.tracks, request);
    if (track) return track;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 200));
  }
  throw new Error("歌曲已导入但房间未及时同步，请稍后再试。");
}
