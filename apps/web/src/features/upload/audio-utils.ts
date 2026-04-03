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
  const codec = file.type.split("/")[1]?.trim() || null;

  return {
    title,
    artist: "本地上传",
    album: null,
    durationMs,
    bitrate: null,
    sizeBytes: file.size,
    codec,
    mimeType: file.type || null,
    fileHash,
    artworkUrl: null,
    ownerSessionId: session.userId,
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
      audio.onloadedmetadata = null;
      audio.ontimeupdate = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };

    audio.onloadedmetadata = () => {
      if (audio.duration === Infinity) {
        audio.currentTime = 1e101;
        audio.ontimeupdate = () => {
          audio.ontimeupdate = null;
          const duration = audio.duration;
          cleanup();
          resolve(Number.isFinite(duration) ? Math.round(duration * 1000) : 0);
        };
      } else {
        const duration = audio.duration;
        cleanup();
        resolve(Number.isFinite(duration) ? Math.round(duration * 1000) : 0);
      }
    };

    audio.onerror = () => {
      cleanup();
      resolve(0);
    };

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

  return null;
}
