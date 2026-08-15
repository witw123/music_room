"use client";
/* eslint-disable @next/next/no-img-element */

import type { TrackMeta } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { RoomProviderTrackSearch } from "./RoomProviderTrackSearch";
import { RoomStage } from "./RoomStage";
import { buildRoomStageProps, type RoomDashboardViewProps } from "./RoomDashboardView";

export function RadioRoomView(props: RoomDashboardViewProps) {
  const isHost = props.roomSnapshot.room.hostId === props.activeSession?.userId;
  const playback = props.roomSnapshot.room.playback;
  const currentTrack = props.currentTrack;
  const upcomingTracks = props.roomSnapshot.queue
    .filter((item) => item.id !== playback.currentQueueItemId)
    .map((item) => props.roomSnapshot.tracks.find((track) => track.id === item.trackId))
    .filter((track): track is TrackMeta => !!track)
    .slice(0, 6);
  const onAir = playback.status === "playing" && !!currentTrack;

  return <div className="hide-scrollbar h-full min-h-0 overflow-y-auto overscroll-contain pb-[var(--room-mobile-bottom-inset)] lg:pb-32" data-room-view="radio">
    <section className="relative min-h-[34rem] border-b border-white/[0.06]">
      <div className="absolute left-0 right-0 top-[calc(10rem+env(safe-area-inset-top))] z-10 flex items-center justify-between gap-3 px-4 md:top-[calc(8rem+env(safe-area-inset-top))] sm:px-6 lg:px-8">
        <span className={`border px-2.5 py-1 font-mono text-[11px] font-semibold ${onAir ? "border-accent/60 bg-accent/10 text-accent" : "border-surface-border bg-surface/40 text-foreground-muted"}`}>{onAir ? "ON AIR" : "OFF AIR"}</span>
        <span className="text-xs text-foreground-muted">{props.roomSnapshot.room.directoryOnlineMemberCount ?? props.roomSnapshot.room.members.filter((member) => member.presenceState === "online").length} 位听众在线</span>
      </div>
      <RoomStage {...buildRoomStageProps(props)} />
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
        {upcomingTracks.length ? <div className="mt-3 divide-y divide-surface-border border-y border-surface-border">{upcomingTracks.map((track, index) => <ProgramTrack key={track.id} track={track} index={index} />)}</div> : <div className="py-14 text-center text-sm text-foreground-muted">{isHost ? "节目单为空。先导入歌曲，再加入待播队列。" : "主持人正在准备下一段播放。"}</div>}
      </div>

      {isHost ? <HostBroadcastDesk {...props} /> : <ListenerBroadcastDesk currentTrack={currentTrack} hostName={props.host?.nickname ?? "房主"} onAir={onAir} />}
    </section>
  </div>;
}

function HostBroadcastDesk(props: RoomDashboardViewProps) {
  return <aside className="px-4 py-6 sm:px-6 lg:px-7 lg:py-8">
    <div className="border-b border-surface-border pb-4"><h2 className="font-semibold text-foreground">主持人控制台</h2><p className="mt-1 text-sm text-foreground-muted">导入歌曲后，将它们加入节目单。</p></div>
    <div className="mt-5">
      <RoomProviderTrackSearch
        canManageLibrary
        mode="import"
        onImportNeteaseTrack={props.onImportNeteaseTrack}
        onImportQqMusicTrack={props.onImportQqMusicTrack}
        roomTracks={props.roomSnapshot.tracks}
        testId="radio-room-import"
      />
    </div>
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

function ProgramTrack({ track, index }: { track: TrackMeta; index: number }) {
  return <article className="flex min-w-0 items-center gap-3 py-3"><span className="w-5 text-right font-mono text-xs text-foreground-muted">{index + 1}</span><TrackArtwork track={track} /><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{track.title}</p><p className="mt-1 truncate text-xs text-foreground-muted">{track.artist}</p></div></article>;
}

function TrackArtwork({ track, large = false }: { track: TrackMeta; large?: boolean }) {
  const size = large ? "h-14 w-14" : "h-9 w-9";
  return track.artworkUrl ? <img alt="" className={`${size} shrink-0 object-cover`} src={track.artworkUrl} /> : <span className={`${size} flex shrink-0 items-center justify-center bg-white/[0.06] text-[10px] text-foreground-muted`}>音乐</span>;
}
