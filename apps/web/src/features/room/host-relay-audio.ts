"use client";

import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";

export type HostPublishSourceTarget =
  | "local-audio"
  | "remote-audio"
  | "pcm-relay-stream"
  | "silent-prewarm"
  | "none";

export type HostPublishTrackKind = "host-capture" | "relay-stream" | "silent-prewarm" | "none";

export type HostPublishReadiness = "idle" | "awaiting-audio" | "ready" | "failed";

export type ResolvedPublishElement = "local-audio" | "remote-audio" | "none";

export type ResolvedPublishStreamKind =
  | "audio-element-capture"
  | "pcm-relay-stream"
  | "silent-prewarm"
  | "none";

export type HostPublishSourceResolution = {
  publishTarget: HostPublishSourceTarget;
  audioElement: HTMLAudioElement | null;
  stream: MediaStream | null;
  trackKind: HostPublishTrackKind;
  isAudibleReady: boolean;
  readiness: HostPublishReadiness;
  reason: string | null;
  resolvedPublishElement: ResolvedPublishElement;
  resolvedPublishStreamKind: ResolvedPublishStreamKind;
};

type HostAudioElementLike =
  | Pick<HTMLAudioElement, "paused" | "readyState" | "srcObject" | "currentSrc" | "src">
  | null;

const haveCurrentDataReadyState = 2;

function hasBoundAudioSource(audio: HostAudioElementLike) {
  if (!audio) {
    return false;
  }

  return !!audio.srcObject || !!audio.currentSrc || !!audio.src;
}

function isAudioElementAudibleReady(audio: HostAudioElementLike) {
  if (!audio || audio.paused) {
    return false;
  }

  return !!audio.srcObject || audio.readyState >= haveCurrentDataReadyState;
}

function resolvePublishElementLabel(
  audio: HostAudioElementLike,
  localAudio: HostAudioElementLike,
  remoteAudio: HostAudioElementLike
): ResolvedPublishElement {
  if (!audio) {
    return "none";
  }

  if (audio === localAudio) {
    return "local-audio";
  }

  if (audio === remoteAudio) {
    return "remote-audio";
  }

  return "none";
}

export function resolveHostRelayAudioElement(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  isCurrentSourceOwner: boolean;
  forceSourceOwnerLocalPlayback: boolean;
  localAudio: HTMLAudioElement | null;
  remoteAudio: HTMLAudioElement | null;
  hasPlayableLiveUpload: boolean;
  hostRelayStreamAvailable: boolean;
}) {
  const localReady = isAudioElementAudibleReady(input.localAudio);
  const remoteReady = isAudioElementAudibleReady(input.remoteAudio);
  const localBound = hasBoundAudioSource(input.localAudio);
  const remoteBound = hasBoundAudioSource(input.remoteAudio);

  if (input.isCurrentSourceOwner) {
    return input.localAudio;
  }

  if (input.forceSourceOwnerLocalPlayback && input.localAudio) {
    return input.localAudio;
  }

  if (input.hostRelayStreamAvailable) {
    if (localReady) {
      return input.localAudio;
    }
    if (remoteReady) {
      return input.remoteAudio;
    }
  }

  if (localReady && !remoteReady) {
    return input.localAudio;
  }

  if (remoteReady && !localReady) {
    return input.remoteAudio;
  }

  if (input.activePlaybackSource === "remote-stream" && remoteReady) {
    return input.remoteAudio;
  }

  if (localReady) {
    return input.localAudio;
  }

  if (remoteReady) {
    return input.remoteAudio;
  }

  if (input.activePlaybackSource === "remote-stream" && remoteBound) {
    return input.remoteAudio;
  }

  if (input.localAudio && (input.isCurrentSourceOwner || input.hasPlayableLiveUpload || localBound)) {
    return input.localAudio;
  }

  if (input.remoteAudio && remoteBound) {
    return input.remoteAudio;
  }

  return input.localAudio ?? input.remoteAudio;
}

export function resolveHostPublishSource(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  isCurrentSourceOwner: boolean;
  forceSourceOwnerLocalPlayback: boolean;
  localAudio: HTMLAudioElement | null;
  remoteAudio: HTMLAudioElement | null;
  hostRelayStream: MediaStream | null;
  hasPlayableLiveUpload: boolean;
}): HostPublishSourceResolution {
  const relayTrack = input.hostRelayStream?.getAudioTracks()[0] ?? null;
  const relayReady =
    !!relayTrack &&
    relayTrack.enabled !== false &&
    relayTrack.muted !== true &&
    relayTrack.readyState === "live";
  const shouldPreferRelayStream = relayReady && !input.isCurrentSourceOwner;

  if (shouldPreferRelayStream && input.hostRelayStream) {
    return {
      publishTarget: "pcm-relay-stream" as const,
      audioElement: null,
      stream: input.hostRelayStream,
      trackKind: "relay-stream" as const,
      isAudibleReady: true,
      readiness: "ready" as const,
      reason: null,
      resolvedPublishElement: "none" as const,
      resolvedPublishStreamKind: "pcm-relay-stream" as const
    };
  }

  const resolvedElement = resolveHostRelayAudioElement({
    activePlaybackSource: input.activePlaybackSource,
    isCurrentSourceOwner: input.isCurrentSourceOwner,
    forceSourceOwnerLocalPlayback: input.forceSourceOwnerLocalPlayback,
    localAudio: input.localAudio,
    remoteAudio: input.remoteAudio,
    hasPlayableLiveUpload: input.hasPlayableLiveUpload,
    hostRelayStreamAvailable: relayReady
  });
  const resolvedPublishElement = resolvePublishElementLabel(
    resolvedElement,
    input.localAudio,
    input.remoteAudio
  );

  if (!resolvedElement) {
    return {
      publishTarget: "none" as const,
      audioElement: null,
      stream: null,
      trackKind: "none" as const,
      isAudibleReady: false,
      readiness: "failed" as const,
      reason: "missing-publish-audio-target",
      resolvedPublishElement: "none" as const,
      resolvedPublishStreamKind: "none" as const
    };
  }

  if (isAudioElementAudibleReady(resolvedElement)) {
    return {
      publishTarget: resolvedPublishElement,
      audioElement: resolvedElement,
      stream: null,
      trackKind: "host-capture" as const,
      isAudibleReady: true,
      readiness: "ready" as const,
      reason: null,
      resolvedPublishElement,
      resolvedPublishStreamKind: "audio-element-capture" as const
    };
  }

  if (hasBoundAudioSource(resolvedElement)) {
    return {
      publishTarget: resolvedPublishElement,
      audioElement: resolvedElement,
      stream: null,
      trackKind: "host-capture" as const,
      isAudibleReady: false,
      readiness: "awaiting-audio" as const,
      reason: `${resolvedPublishElement}-not-yet-playing`,
      resolvedPublishElement,
      resolvedPublishStreamKind: "audio-element-capture" as const
    };
  }

  return {
    publishTarget: resolvedPublishElement,
    audioElement: resolvedElement,
    stream: null,
    trackKind: "host-capture" as const,
    isAudibleReady: false,
    readiness: "failed" as const,
    reason: `${resolvedPublishElement}-has-no-bound-source`,
    resolvedPublishElement,
    resolvedPublishStreamKind: "audio-element-capture" as const
  };
}
