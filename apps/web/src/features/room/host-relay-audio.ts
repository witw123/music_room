"use client";

export type HostPublishSourceTarget =
  | "local-audio"
  | "pcm-relay-stream"
  | "silent-prewarm"
  | "none";

export type HostPublishTrackKind = "host-capture" | "relay-stream" | "silent-prewarm" | "none";

export type HostPublishReadiness = "idle" | "awaiting-audio" | "ready" | "failed";

export type ResolvedPublishElement = "local-audio" | "none";

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
  localAudio: HostAudioElementLike
): ResolvedPublishElement {
  if (!audio) {
    return "none";
  }

  if (audio === localAudio) {
    return "local-audio";
  }

  return "none";
}

export function resolveHostRelayAudioElement(input: {
  isCurrentSourceOwner: boolean;
  forceSourceOwnerLocalPlayback: boolean;
  localAudio: HTMLAudioElement | null;
  hasPlayableLiveUpload: boolean;
}) {
  const localReady = isAudioElementAudibleReady(input.localAudio);
  const localBound = hasBoundAudioSource(input.localAudio);

  if (input.isCurrentSourceOwner) {
    return input.localAudio;
  }

  if (input.forceSourceOwnerLocalPlayback && input.localAudio) {
    return input.localAudio;
  }

  if (localReady) {
    return input.localAudio;
  }

  if (input.localAudio && (input.isCurrentSourceOwner || input.hasPlayableLiveUpload || localBound)) {
    return input.localAudio;
  }

  return input.localAudio;
}

export function resolveHostPublishSource(input: {
  isCurrentSourceOwner: boolean;
  forceSourceOwnerLocalPlayback: boolean;
  localAudio: HTMLAudioElement | null;
  hasPlayableLiveUpload: boolean;
}): HostPublishSourceResolution {

  const resolvedElement = resolveHostRelayAudioElement({
    isCurrentSourceOwner: input.isCurrentSourceOwner,
    forceSourceOwnerLocalPlayback: input.forceSourceOwnerLocalPlayback,
    localAudio: input.localAudio,
    hasPlayableLiveUpload: input.hasPlayableLiveUpload,
  });
  const resolvedPublishElement = resolvePublishElementLabel(
    resolvedElement,
    input.localAudio,
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
