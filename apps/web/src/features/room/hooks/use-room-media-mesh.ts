"use client";

import { useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { PeerSignalMessage, RoomMediaConnectionState, RoomSnapshot } from "@music-room/shared";
import { RoomMediaMesh } from "@/features/p2p";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import { captureAudioStream } from "@/features/upload/audio-utils";
import { isCurrentPlaybackSourceDevice } from "@/features/playback/playback-source-identity";
import { hasActivePlaybackIntent, type ProgressivePlaybackSource } from "@/features/playback/progressive-playback";
import type { RoomSocket } from "@/lib/ws-client";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { getWebRTCIceServers } from "@/features/p2p";
import type { IceConfigResponse } from "@music-room/shared";

export function resolveRoomMediaPeerIds(input: {
  roomSnapshot: RoomSnapshot | null;
  peerId: string;
  isCurrentSourceDevice: boolean;
}) {
  const playback = input.roomSnapshot?.room.playback ?? null;
  if (!playback?.sourcePeerId || !hasActivePlaybackIntent(playback)) {
    return [];
  }

  if (input.isCurrentSourceDevice) {
    return (
      input.roomSnapshot?.room.members
        .map((member) => member.peerId)
        .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== input.peerId) ?? []
    );
  }

  return playback.sourcePeerId === input.peerId ? [] : [playback.sourcePeerId];
}

export function shouldBindRemoteRoomMediaStream(input: {
  remotePeerId: string;
  sourcePeerId: string | null | undefined;
  isCurrentSourceDevice: boolean;
}) {
  return (
    !input.isCurrentSourceDevice &&
    !!input.sourcePeerId &&
    input.remotePeerId === input.sourcePeerId
  );
}

export function shouldRefreshPublishedRoomMediaStream(input: {
  previousPublishKey: string | null | undefined;
  nextPublishKey: string | null | undefined;
}) {
  return !!input.nextPublishKey && input.previousPublishKey !== input.nextPublishKey;
}

export function useRoomMediaMesh(input: {
  roomSnapshot: RoomSnapshot | null;
  peerId: string;
  activeSessionId: string | null | undefined;
  audioRef: RefObject<HTMLAudioElement | null>;
  mediaMeshRef?: MutableRefObject<RoomMediaMesh | null>;
  socketRef: MutableRefObject<RoomSocket | null>;
  iceConfig: IceConfigResponse | null;
  audioUnlocked: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  setActivePlaybackSource: Dispatch<SetStateAction<ProgressivePlaybackSource>>;
  setMediaConnectedPeers: Dispatch<SetStateAction<string[]>>;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
}) {
  const ownedMediaMeshRef = useRef<RoomMediaMesh | null>(null);
  const mediaMeshRef = input.mediaMeshRef ?? ownedMediaMeshRef;
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamPeerRef = useRef<string | null>(null);
  const publishedStreamKeyRef = useRef<string | null>(null);
  const latestPlaybackStateRef = useRef({
    sourcePeerId: null as string | null,
    isCurrentSourceDevice: false
  });
  const playback = input.roomSnapshot?.room.playback ?? null;
  const isCurrentSourceDevice = isCurrentPlaybackSourceDevice({
    playback,
    peerId: input.peerId,
    activeSessionId: input.activeSessionId
  });
  latestPlaybackStateRef.current = {
    sourcePeerId: playback?.sourcePeerId ?? null,
    isCurrentSourceDevice
  };
  const mediaPeerIds = resolveRoomMediaPeerIds({
    roomSnapshot: input.roomSnapshot,
    peerId: input.peerId,
    isCurrentSourceDevice
  });

  useEffect(() => {
    if (!input.roomSnapshot?.room.id || !input.peerId) {
      return;
    }

    const mesh = new RoomMediaMesh(
      input.roomSnapshot.room.id,
      input.peerId,
      (payload: PeerSignalMessage) => {
        const socket = input.socketRef.current;
        if (!socket?.connected) {
          return;
        }
        socket.emit("peer.signal", payload);
      },
      {
        getLocalStream: () => localStreamRef.current,
        onRemoteStream: ({ peerId, stream }) => {
          const latestPlaybackState = latestPlaybackStateRef.current;
          if (
            !shouldBindRemoteRoomMediaStream({
              remotePeerId: peerId,
              sourcePeerId: latestPlaybackState.sourcePeerId,
              isCurrentSourceDevice: latestPlaybackState.isCurrentSourceDevice
            })
          ) {
            return;
          }
          const audio = input.audioRef.current;
          if (!audio) {
            return;
          }
          remoteStreamPeerRef.current = peerId;
          if (audio.srcObject !== stream) {
            audio.pause();
            audio.removeAttribute("src");
            audio.srcObject = stream;
          }
          audio.muted = false;
          input.setActivePlaybackSource("media-stream");
          input.setMediaConnectionState("buffering");
          void roomAudioOutput.playElement(audio).then((result) => {
            input.setMediaConnectionState(result.ok ? "live" : "buffering");
            input.recordPeerDiagnostic({
              peerId,
              channelKind: "media",
              direction: "local",
              event: result.ok ? "remote-media-play" : "remote-media-play-blocked",
              summary: result.ok
                ? "远端实时音频已接入"
                : `远端实时音频等待解锁：${result.error ?? "play blocked"}`,
              level: result.ok ? "info" : "warning"
            });
          });
        },
        onRemoteStreamRemoved: ({ peerId }) => {
          if (remoteStreamPeerRef.current !== peerId) {
            return;
          }
          remoteStreamPeerRef.current = null;
          const audio = input.audioRef.current;
          if (audio?.srcObject) {
            audio.pause();
            audio.srcObject = null;
            audio.load();
          }
          input.setMediaConnectionState("reconnecting");
          input.setActivePlaybackSource((current) =>
            current === "media-stream" ? "progressive-local" : current
          );
        },
        onPeerConnectionChange: ({ peerId, state }) => {
          input.recordPeerDiagnostic({
            peerId,
            channelKind: "media",
            direction: "local",
            event: "connection-state",
            summary: `Media 连接状态：${state}`,
            update: (snapshot) => ({
              ...snapshot,
              mediaConnectionState: state,
              transportHealth:
                state === "connected"
                  ? "media-only"
                  : state === "failed" || state === "closed"
                    ? "failed"
                    : snapshot.transportHealth
            })
          });
          input.setMediaConnectedPeers(mesh.getConnectedPeerIds());
        },
        onIceConnectionStateChange: ({ peerId, state }) => {
          input.recordPeerDiagnostic({
            peerId,
            channelKind: "media",
            direction: "local",
            event: "ice-state",
            summary: `Media ICE 状态：${state}`,
            update: (snapshot) => ({
              ...snapshot,
              mediaIceState: state
            })
          });
        },
        onSignal: ({ peerId, direction, type }) => {
          input.recordPeerDiagnostic({
            peerId,
            channelKind: "media",
            direction,
            event: type,
            summary: `${direction === "sent" ? "发送" : "收到"} ${peerId} 的 media ${type}`
          });
        }
      },
      getWebRTCIceServers(input.iceConfig)
    );
    mediaMeshRef.current = mesh;

    return () => {
      mesh.destroy();
      mediaMeshRef.current = null;
      localStreamRef.current = null;
      remoteStreamPeerRef.current = null;
      input.setMediaConnectedPeers([]);
    };
  }, [input.roomSnapshot?.room.id, input.peerId, input.iceConfig]);

  useEffect(() => {
    if (!isCurrentSourceDevice) {
      return;
    }
    const audio = input.audioRef.current;
    const mesh = mediaMeshRef.current;
    if (!audio || !mesh) {
      return;
    }

    const publishCurrentAudio = () => {
      const publishKey = buildRoomMediaPublishKey(playback);
      const forceRefresh = shouldRefreshPublishedRoomMediaStream({
        previousPublishKey: publishedStreamKeyRef.current,
        nextPublishKey: publishKey
      });
      const stream = captureAudioStream(audio, { forceRefresh });
      localStreamRef.current = stream;
      if (stream && publishKey) {
        publishedStreamKeyRef.current = publishKey;
      }
      input.setMediaConnectionState(stream ? "live" : "buffering");
      void mesh.publishLocalStream(stream);
    };

    audio.addEventListener("playing", publishCurrentAudio);
    audio.addEventListener("canplay", publishCurrentAudio);
    audio.addEventListener("loadeddata", publishCurrentAudio);
    return () => {
      audio.removeEventListener("playing", publishCurrentAudio);
      audio.removeEventListener("canplay", publishCurrentAudio);
      audio.removeEventListener("loadeddata", publishCurrentAudio);
    };
  }, [
    input.audioRef,
    input.roomSnapshot?.room.id,
    isCurrentSourceDevice,
    mediaMeshRef,
    playback?.currentTrackId,
    playback?.mediaEpoch
  ]);

  useEffect(() => {
    const mesh = mediaMeshRef.current;
    if (!mesh) {
      return;
    }
    if (!playback?.currentTrackId || !hasActivePlaybackIntent(playback)) {
      localStreamRef.current = null;
      publishedStreamKeyRef.current = null;
      void mesh.syncPeers([]);
      input.setMediaConnectedPeers([]);
      input.setMediaConnectionState("idle");
      return;
    }

    if (isCurrentSourceDevice) {
      const audio = input.audioRef.current;
      const publishKey = buildRoomMediaPublishKey(playback);
      const forceRefresh = shouldRefreshPublishedRoomMediaStream({
        previousPublishKey: publishedStreamKeyRef.current,
        nextPublishKey: publishKey
      });
      const stream = audio ? captureAudioStream(audio, { forceRefresh }) : null;
      localStreamRef.current = stream;
      if (stream && publishKey) {
        publishedStreamKeyRef.current = publishKey;
      }
      input.setMediaConnectionState(stream ? "live" : "buffering");
      if (!stream) {
        input.recordPeerDiagnostic({
          peerId: "system",
          channelKind: "media",
          direction: "local",
          event: "host-media-capture-missing",
          summary: "本机音频流尚未可捕获，等待本地播放器启动",
          level: "warning"
        });
      }
      void mesh.publishLocalStream(stream);
    } else {
      localStreamRef.current = null;
      if (input.activePlaybackSource === "media-stream") {
        input.setMediaConnectionState("connecting");
      }
    }

    void mesh.syncPeers(mediaPeerIds, localStreamRef.current).then(() => {
      input.setMediaConnectedPeers(mesh.getConnectedPeerIds());
      if (!isCurrentSourceDevice && mediaPeerIds.length > 0 && input.activePlaybackSource !== "media-stream") {
        input.setMediaConnectionState("connecting");
      }
    });
  }, [
    input.activePlaybackSource,
    input.audioRef,
    input.audioUnlocked,
    input.roomSnapshot?.room.members,
    isCurrentSourceDevice,
    mediaPeerIds.join("|"),
    playback?.currentTrackId,
    playback?.mediaEpoch,
    playback?.sourcePeerId,
    playback?.status
  ]);

  return {
    mediaMeshRef
  };
}

function buildRoomMediaPublishKey(playback: RoomSnapshot["room"]["playback"] | null | undefined) {
  if (!playback?.currentTrackId || !hasActivePlaybackIntent(playback)) {
    return null;
  }

  return `${playback.currentTrackId}:${playback.mediaEpoch ?? 0}`;
}
