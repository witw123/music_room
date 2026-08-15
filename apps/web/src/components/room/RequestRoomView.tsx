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

  useEffect(() => {
    snapshotRef.current = props.roomSnapshot;
  }, [props.roomSnapshot]);

  const requests = props.roomSnapshot.room.requests ?? [];
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

  const submitRequest = async (track: ProviderCandidate) => {
    setMessage(null);
    await musicRoomApi.createRoomRequest(roomId, {
      provider: track.provider,
      providerTrackId: track.providerTrackId,
      title: track.title,
      artist: track.artist,
      album: track.album ?? null,
      durationMs: track.durationMs,
      artworkUrl: track.artworkUrl ?? null
    });
    setMessage(`《${track.title}》已送入房主审核队列。`);
  };

  const decideRequest = async (request: RoomRequest, decision: "approved" | "rejected") => {
    if (pendingRequestId) return;
    setPendingRequestId(request.id);
    setMessage(null);
    try {
      if (decision === "rejected") {
        await musicRoomApi.rejectRoomRequest(roomId, request.id);
        setMessage(`已拒绝《${request.title}》。`);
        return;
      }

      // Read the server state before retrying so a queue add that succeeded
      // before a later approval failure is never duplicated.
      snapshotRef.current = await musicRoomApi.getRoom(roomId);
      const track = await importRequestedTrack(request, props, snapshotRef);
      snapshotRef.current = await musicRoomApi.getRoom(roomId);
      const alreadyQueued = snapshotRef.current.queue.some((item) => item.trackId === track.id);
      if (!alreadyQueued) {
        const queuedItem = await props.onAddToQueue(track.id);
        if (!queuedItem) {
          throw new Error("歌曲未能加入共享队列，点歌仍保持待审核。请检查房主权限或稍后重试。");
        }
      }
      await musicRoomApi.approveRoomRequest(roomId, request.id);
      setMessage(`《${request.title}》已加入共享队列。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "处理点歌失败，请稍后重试。");
    } finally {
      setPendingRequestId(null);
    }
  };

  return <div className="hide-scrollbar h-full min-h-0 overflow-y-auto overscroll-contain pb-[var(--room-mobile-bottom-inset)] lg:pb-32" data-room-view="request">
    <div className="grid min-h-full min-w-0 lg:grid-cols-[minmax(0,0.94fr)_minmax(25rem,0.76fr)]">
      <section className="min-h-[31rem] border-b border-white/[0.06] lg:min-h-0 lg:border-b-0 lg:border-r">
        <RoomStage {...buildRoomStageProps(props)} />
      </section>
      <section className="min-w-0 px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <header className="flex flex-wrap items-end justify-between gap-3 border-b border-surface-border pb-4">
            <div>
              <h1 className="text-xl font-semibold text-foreground">点歌台</h1>
              <p className="mt-1 text-sm text-foreground-muted">{isHost ? "审核点歌并安排接下来的播放。" : "搜索歌曲，提交给房主审核。"}</p>
            </div>
            <span className="font-mono text-xs text-foreground-muted">{pendingRequests.length} 首待处理</span>
          </header>

          {isHost ? <RequestInbox
            pendingRequestId={pendingRequestId}
            pendingRequests={pendingRequests}
            handledRequests={handledRequests}
            onDecide={decideRequest}
          /> : <>
            <RoomProviderTrackSearch
              mode="request"
              roomTracks={props.roomSnapshot.tracks}
              onRequestTrack={submitRequest}
              testId="request-room-search"
            />
            <RequestHistory requests={myRequests} title="我的点歌" />
          </>}

          <QueuePreview queue={props.roomSnapshot.queue} tracks={props.roomSnapshot.tracks} />
          {message ? <p className="border border-surface-border bg-surface/40 px-3 py-2.5 text-sm text-foreground-muted" role="status">{message}</p> : null}
        </div>
      </section>
    </div>
  </div>;
}

function RequestInbox({
  pendingRequestId,
  pendingRequests,
  handledRequests,
  onDecide
}: {
  pendingRequestId: string | null;
  pendingRequests: RoomRequest[];
  handledRequests: RoomRequest[];
  onDecide: (request: RoomRequest, decision: "approved" | "rejected") => Promise<void>;
}) {
  return <section className="border border-surface-border bg-surface/20" data-testid="request-room-inbox">
    <div className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-3">
      <h2 className="font-semibold text-foreground">待审核点歌</h2>
      <span className="text-xs text-foreground-muted">接受后自动加入队列</span>
    </div>
    {pendingRequests.length ? <div className="divide-y divide-surface-border">
      {pendingRequests.map((request) => <RequestTicket
        key={request.id}
        request={request}
        pending={pendingRequestId === request.id}
        onDecide={onDecide}
      />)}
    </div> : <div className="px-4 py-12 text-center text-sm text-foreground-muted">还没有等待审核的点歌。</div>}
    {handledRequests.length ? <div className="border-t border-surface-border px-4 py-3">
      <p className="text-xs text-foreground-muted">最近处理</p>
      <div className="mt-2 divide-y divide-white/[0.06]">
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
  onDecide: (request: RoomRequest, decision: "approved" | "rejected") => Promise<void>;
}) {
  return <article className="flex min-w-0 gap-3 px-4 py-4">
    <Artwork artworkUrl={request.artworkUrl} title={request.title} />
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold text-foreground">{request.title}</p>
      <p className="mt-1 truncate text-xs text-foreground-muted">{request.artist}{request.album ? ` · ${request.album}` : ""}</p>
      <p className="mt-2 text-[11px] text-foreground-muted">{request.requesterName} · {formatDuration(request.durationMs)}</p>
    </div>
    <div className="flex shrink-0 flex-col justify-center gap-2 sm:flex-row sm:items-center">
      <Button disabled={pending} onClick={() => void onDecide(request, "approved")} size="sm" type="button">
        {pending ? "处理中…" : "接纳入队"}
      </Button>
      <Button disabled={pending} onClick={() => void onDecide(request, "rejected")} size="sm" type="button" variant="ghost">
        拒绝
      </Button>
    </div>
  </article>;
}

function RequestHistory({ requests, title }: { requests: RoomRequest[]; title: string }) {
  return <section className="border border-surface-border bg-surface/20">
    <div className="border-b border-surface-border px-4 py-3"><h2 className="font-semibold text-foreground">{title}</h2></div>
    {requests.length ? <div className="divide-y divide-surface-border">{requests.slice().reverse().map((request) => <RequestHistoryRow key={request.id} request={request} />)}</div> : <div className="px-4 py-10 text-center text-sm text-foreground-muted">还没有提交过点歌。</div>}
  </section>;
}

function RequestHistoryRow({ request }: { request: RoomRequest }) {
  const status = request.status === "approved" ? "已加入队列" : request.status === "rejected" ? "未被接纳" : "等待审核";
  return <div className="flex min-w-0 items-center gap-3 py-2.5">
    <Artwork artworkUrl={request.artworkUrl} title={request.title} compact />
    <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-foreground">{request.title}</p><p className="mt-0.5 truncate text-[11px] text-foreground-muted">{request.artist}</p></div>
    <span className="shrink-0 text-[11px] text-foreground-muted">{status}</span>
  </div>;
}

function QueuePreview({ queue, tracks }: { queue: RoomDashboardViewProps["roomSnapshot"]["queue"]; tracks: TrackMeta[] }) {
  const items = queue.slice(0, 4).map((item) => tracks.find((track) => track.id === item.trackId)).filter((track): track is TrackMeta => !!track);
  return <section className="border-t border-surface-border pt-5">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-foreground">即将播放</h2><span className="text-xs text-foreground-muted">{queue.length} 首在队列</span></div>
    {items.length ? <div className="mt-3 divide-y divide-surface-border border-y border-surface-border">{items.map((track) => <div className="flex min-w-0 items-center gap-3 py-2.5" key={track.id}><Artwork artworkUrl={track.artworkUrl} title={track.title} compact /><div className="min-w-0"><p className="truncate text-xs font-medium text-foreground">{track.title}</p><p className="mt-0.5 truncate text-[11px] text-foreground-muted">{track.artist}</p></div></div>)}</div> : <p className="mt-3 text-sm text-foreground-muted">房主接纳点歌后，它们会按队列在这里出现。</p>}
  </section>;
}

function Artwork({ artworkUrl, title, compact = false }: { artworkUrl: string | null; title: string; compact?: boolean }) {
  const size = compact ? "h-8 w-8" : "h-11 w-11";
  return artworkUrl ? <img alt="" className={`${size} shrink-0 object-cover`} src={artworkUrl} /> : <span aria-label={`${title} 无封面`} className={`${size} flex shrink-0 items-center justify-center bg-white/[0.06] text-[10px] text-foreground-muted`}>音乐</span>;
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
    const track = findProviderTrack(snapshotRef.current.tracks, request);
    if (track) return track;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 200));
  }
  throw new Error("歌曲已导入但房间未及时同步，请稍后再试。");
}
