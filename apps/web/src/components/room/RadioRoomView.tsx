"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import type { NeteaseTrackCandidate, QqMusicTrackCandidate, QueueItem, TrackMeta } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { RoomProviderTrackSearch } from "./RoomProviderTrackSearch";
import { RoomStage } from "./RoomStage";
import { buildRoomStageProps, type RoomDashboardViewProps } from "./RoomDashboardView";
import { useRadioAutopilot } from "./hooks/use-radio-autopilot";

type ProviderCandidate = NeteaseTrackCandidate | QqMusicTrackCandidate;

export function RadioRoomView(props: RoomDashboardViewProps) {
  if (!props.roomSnapshot.room.radioAutopilot) {
    return <RadioAutopilotUnavailable />;
  }

  const isHost = props.roomSnapshot.room.hostId === props.activeSession?.userId;
  const playback = props.roomSnapshot.room.playback;
  const currentTrack = props.currentTrack;
  const upcomingTracks = props.roomSnapshot.queue
    .filter((item) => item.id !== playback.currentQueueItemId)
    .map((queueItem) => ({
      queueItem,
      track: props.roomSnapshot.tracks.find((track) => track.id === queueItem.trackId)
    }))
    .filter((entry): entry is { queueItem: QueueItem; track: TrackMeta } => !!entry.track)
    .slice(0, 6);
  const onAir = playback.status === "playing" && !!currentTrack;

  return <div className="hide-scrollbar h-full min-h-0 overflow-y-auto overscroll-contain pb-[var(--room-mobile-bottom-inset)] lg:pb-32" data-room-view="radio">
    <section className="relative min-h-[30rem] border-b border-white/[0.06] lg:min-h-[34rem]">
      <RoomStage {...buildRoomStageProps(props, { showMobilePlayer: true })} />
    </section>

    <section className="mx-auto grid w-full max-w-[1400px] gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(23rem,0.66fr)]">
      <div className="border-b border-surface-border px-4 py-6 sm:px-6 lg:border-b-0 lg:border-r lg:px-8 lg:py-8">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-surface-border pb-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">节目单</h1>
            <p className="mt-1 text-sm text-foreground-muted">{isHost ? "安排接下来要播出的内容。" : "主持人接下来准备播放的曲目。"}</p>
          </div>
          <span className="font-mono text-xs text-foreground-muted">{props.roomSnapshot.queue.length} 首待播</span>
        </header>
        {upcomingTracks.length ? <div className="mt-3 divide-y divide-surface-border border-y border-surface-border">{upcomingTracks.map(({ queueItem, track }, index) => <ProgramTrack key={queueItem.id} track={track} index={index} source={queueItem.source} />)}</div> : <div className="py-14 text-center text-sm text-foreground-muted">{isHost ? "节目单为空。导入歌曲后会自动加入待播队列。" : "主持人正在准备下一段播放。"}</div>}
      </div>

      {isHost ? <HostBroadcastDesk {...props} /> : <ListenerBroadcastDesk currentTrack={currentTrack} hostName={props.host?.nickname ?? "房主"} onAir={onAir} />}
    </section>
  </div>;
}

function RadioAutopilotUnavailable() {
  return <div className="flex h-full min-h-0 items-center justify-center px-4 pb-[var(--room-mobile-bottom-inset)] lg:px-8 lg:pb-32" data-room-view="radio">
    <section className="w-full max-w-xl border border-surface-border bg-surface/25 px-5 py-6 sm:px-6" role="alert">
      <p className="font-mono text-xs font-semibold text-accent">自由电台需要更新</p>
      <h1 className="mt-3 text-xl font-semibold text-foreground">自动推荐尚不可用</h1>
      <p className="mt-3 text-sm leading-6 text-foreground-muted">此房间仍在使用旧的服务端快照。重新构建并重启后端后，重新进入房间即可使用自动推荐。</p>
    </section>
  </div>;
}

function HostBroadcastDesk(props: RoomDashboardViewProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [selectedSeedTrackId, setSelectedSeedTrackId] = useState("");
  const isHost = props.roomSnapshot.room.hostId === props.activeSession?.userId;
  const seedTracks = props.roomSnapshot.tracks.filter(
    (track) => track.sourceType === "netease" || track.sourceType === "qqmusic"
  );
  const autopilot = useRadioAutopilot({
    roomSnapshot: props.roomSnapshot,
    isHost,
    onImportNeteaseTrack: props.onImportNeteaseTrack,
    onImportQqMusicTrack: props.onImportQqMusicTrack,
    onRefreshRoom: props.onRefreshRoom
  });

  useEffect(() => {
    const configuredSeedTrackId = props.roomSnapshot.room.radioAutopilot.seedTrackId;
    if (configuredSeedTrackId && seedTracks.some((track) => track.id === configuredSeedTrackId)) {
      setSelectedSeedTrackId(configuredSeedTrackId);
      return;
    }
    if (!seedTracks.some((track) => track.id === selectedSeedTrackId)) {
      setSelectedSeedTrackId(seedTracks[0]?.id ?? "");
    }
  }, [props.roomSnapshot.room.radioAutopilot.seedTrackId, seedTracks, selectedSeedTrackId]);

  const importAndQueue = async (candidate: ProviderCandidate) => {
    setMessage(null);
    if (candidate.provider === "netease") {
      await props.onImportNeteaseTrack(candidate);
    } else {
      await props.onImportQqMusicTrack(candidate);
    }

    const snapshot = await musicRoomApi.getRoom(props.roomSnapshot.room.id);
    const track = snapshot.tracks.find((item) =>
      item.sourceRef?.provider === candidate.provider && item.sourceRef.trackId === candidate.providerTrackId
    );
    if (!track) {
      throw new Error("歌曲已导入，但尚未同步到节目单。请稍后重试。");
    }
    if (snapshot.queue.some((item) => item.trackId === track.id)) {
      setMessage(`《${track.title}》已在节目单中。`);
      return;
    }

    const queuedItem = await props.onAddToQueue(track.id);
    if (!queuedItem) {
      throw new Error("歌曲已导入，但未能加入节目单。请稍后重试。");
    }
    setMessage(`《${track.title}》已自动加入节目单。`);
  };

  const toggleAutopilot = async () => {
    const current = props.roomSnapshot.room.radioAutopilot;
    setMessage(null);
    try {
      await musicRoomApi.updateRadioAutopilot(props.roomSnapshot.room.id, {
        enabled: !current.enabled,
        seedTrackId: current.enabled ? null : selectedSeedTrackId || null
      });
      await props.onRefreshRoom();
      setMessage(current.enabled ? "自动推荐已停止。" : "自动推荐已开启。播放时会补足节目单。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "自动推荐设置失败。请稍后重试。");
    }
  };

  return <aside className="px-4 py-6 sm:px-6 lg:px-7 lg:py-8">
    <div className="border-b border-surface-border pb-4"><h2 className="font-semibold text-foreground">主持人控制台</h2><p className="mt-1 text-sm text-foreground-muted">导入歌曲后会自动加入节目单。</p></div>
    <section className="mt-5 border border-surface-border bg-surface/25 p-4" data-testid="radio-autopilot">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-sm font-semibold text-foreground">自动推荐</h3><p className="mt-1 text-xs leading-5 text-foreground-muted">播出中且待播不足三首时，从种子歌曲的关联歌单补充节目。</p></div>
        <span className={`border px-2 py-1 font-mono text-[10px] font-semibold ${props.roomSnapshot.room.radioAutopilot.enabled ? "border-accent/50 bg-accent/10 text-accent" : "border-surface-border text-foreground-muted"}`}>{props.roomSnapshot.room.radioAutopilot.enabled ? "运行中" : "已关闭"}</span>
      </div>
      <label className="mt-4 block text-xs font-medium text-foreground-muted" htmlFor="radio-autopilot-seed">种子歌曲</label>
      <select id="radio-autopilot-seed" className="mt-2 w-full border border-surface-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60" disabled={props.roomSnapshot.room.radioAutopilot.enabled || seedTracks.length === 0} onChange={(event) => setSelectedSeedTrackId(event.target.value)} value={selectedSeedTrackId}>
        {seedTracks.length === 0 ? <option value="">先导入网易云音乐或 QQ 音乐歌曲</option> : seedTracks.map((track) => <option key={track.id} value={track.id}>{track.title} · {track.artist}</option>)}
      </select>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={!props.roomSnapshot.room.radioAutopilot.enabled && !selectedSeedTrackId} onClick={() => void toggleAutopilot()} size="sm" type="button" variant={props.roomSnapshot.room.radioAutopilot.enabled ? "outline" : "default"}>{props.roomSnapshot.room.radioAutopilot.enabled ? "停止自动推荐" : "开启自动推荐"}</Button>
        {autopilot.state.kind === "paused" ? <Button onClick={() => void autopilot.retry()} size="sm" type="button" variant="outline">重试补歌</Button> : null}
      </div>
      {autopilot.state.message ? <p className={`mt-3 text-xs leading-5 ${autopilot.state.kind === "paused" ? "text-amber-200" : "text-foreground-muted"}`} role="status">{autopilot.state.message}</p> : null}
    </section>
    <div className="mt-5">
      <RoomProviderTrackSearch
        canManageLibrary
        mode="import"
        onImportNeteaseTrack={importAndQueue}
        onImportQqMusicTrack={importAndQueue}
        roomTracks={props.roomSnapshot.tracks}
        testId="radio-room-import"
      />
    </div>
    {message ? <p className="mt-3 border border-surface-border bg-surface/40 px-3 py-2.5 text-sm text-foreground-muted" role="status">{message}</p> : null}
    <div className="mt-6 border-t border-surface-border pt-5">
      <h3 className="text-sm font-semibold text-foreground">已导入曲库</h3>
      {props.roomSnapshot.tracks.length ? <div className="mt-3 divide-y divide-surface-border border-y border-surface-border">{props.roomSnapshot.tracks.slice(0, 8).map((track) => <div className="flex min-w-0 items-center gap-3 py-2.5" key={track.id}><TrackArtwork track={track} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-foreground">{track.title}</p><p className="mt-0.5 truncate text-[11px] text-foreground-muted">{track.artist}</p></div><Button onClick={() => void props.onAddToQueue(track.id)} size="sm" type="button" variant="outline">加入节目单</Button></div>)}</div> : <p className="mt-3 text-sm text-foreground-muted">还没有可播歌曲。</p>}
    </div>
  </aside>;
}

function ListenerBroadcastDesk({ currentTrack, hostName, onAir }: { currentTrack: TrackMeta | null; hostName: string; onAir: boolean }) {
  return <aside className="px-4 py-6 sm:px-6 lg:px-7 lg:py-8">
    <div className="border-b border-surface-border pb-4"><h2 className="font-semibold text-foreground">收听中</h2><p className="mt-1 text-sm text-foreground-muted">主持人 {hostName} 正在掌控播出。</p></div>
    <div className="mt-6 border border-surface-border bg-surface/25 p-4">
      <p className={`text-xs font-semibold ${onAir ? "text-accent" : "text-foreground-muted"}`}>{onAir ? "当前节目" : "等待播出"}</p>
      {currentTrack ? <div className="mt-4 flex min-w-0 items-center gap-3"><TrackArtwork track={currentTrack} large /><div className="min-w-0"><p className="truncate text-base font-semibold text-foreground">{currentTrack.title}</p><p className="mt-1 truncate text-sm text-foreground-muted">{currentTrack.artist}</p></div></div> : <p className="mt-4 text-sm leading-6 text-foreground-muted">节目单准备完成后，会在这里显示当前播放内容。</p>}
    </div>
    <p className="mt-5 text-sm leading-6 text-foreground-muted">你可以调整本地音量、查看歌词和队列；播放、跳过与节目单编辑由主持人完成。</p>
  </aside>;
}

function ProgramTrack({ track, index, source }: { track: TrackMeta; index: number; source: QueueItem["source"] }) {
  return <article className="flex min-w-0 items-center gap-3 py-3"><span className="w-5 text-right font-mono text-xs text-foreground-muted">{index + 1}</span><TrackArtwork track={track} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{track.title}</p><p className="mt-1 truncate text-xs text-foreground-muted">{track.artist}</p></div>{source === "autopilot" ? <span className="shrink-0 border border-accent/30 bg-accent/10 px-1.5 py-1 font-mono text-[10px] text-accent">自动</span> : null}</article>;
}

function TrackArtwork({ track, large = false }: { track: TrackMeta; large?: boolean }) {
  const size = large ? "h-14 w-14" : "h-9 w-9";
  return track.artworkUrl ? <img alt="" className={`${size} shrink-0 object-cover`} src={track.artworkUrl} /> : <span className={`${size} flex shrink-0 items-center justify-center bg-white/[0.06] text-[10px] text-foreground-muted`}>音乐</span>;
}
