"use client";

import type { GuestSession } from "@music-room/shared";

const capturedAudioGraphs = new WeakMap<
  HTMLAudioElement,
  {
    context: AudioContext;
    stream: MediaStream;
  }
>();

export type UploadedTrack = {
  file: File;
  objectUrl: string;
};

export async function buildTrackMeta(file: File, objectUrl: string, session: GuestSession) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const fileHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const durationMs = await readDuration(objectUrl);
  const title = file.name.replace(/\.[^/.]+$/, "");

  return {
    title,
    artist: "本地上传",
    album: null,
    durationMs,
    bitrate: null,
    fileHash,
    artworkUrl: null,
    ownerSessionId: session.id,
    ownerNickname: session.nickname,
    sourceType: "local_upload" as const
  };
}

export function readDuration(objectUrl: string) {
  return new Promise<number>((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = objectUrl;

    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("error", handleError);
      audio.pause();
      audio.src = "";
      audio.load();
    };

    const handleLoadedMetadata = () => {
      cleanup();
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
    };

    const handleError = () => {
      cleanup();
      resolve(0);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("error", handleError);
    audio.load();
  });
}

export function captureAudioStream(audio: HTMLAudioElement) {
  const cachedGraph = capturedAudioGraphs.get(audio);
  if (cachedGraph) {
    if (cachedGraph.context.state === "suspended") {
      void cachedGraph.context.resume().catch(() => undefined);
    }

    return cachedGraph.stream;
  }

  if (typeof window !== "undefined") {
    const AudioContextCtor = window.AudioContext;
    if (AudioContextCtor) {
      const context = new AudioContextCtor();
      const source = context.createMediaElementSource(audio);
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      source.connect(context.destination);
      capturedAudioGraphs.set(audio, {
        context,
        stream: destination.stream
      });
      if (context.state === "suspended") {
        void context.resume().catch(() => undefined);
      }
      return destination.stream;
    }
  }

  const mediaAudio = audio as HTMLAudioElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };

  if (typeof mediaAudio.captureStream === "function") {
    return mediaAudio.captureStream();
  }

  if (typeof mediaAudio.mozCaptureStream === "function") {
    return mediaAudio.mozCaptureStream();
  }

  return null;
}
