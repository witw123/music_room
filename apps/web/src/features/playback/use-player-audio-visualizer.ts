"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { PlaybackSnapshot } from "@music-room/shared";
import { captureAudioStream } from "@/features/upload/audio-utils";
import type { ProgressivePlaybackSource } from "./progressive-playback";

const analyserFftSize = 256;
const analyserSmoothingTimeConstant = 0.75;
const desktopSampleCount = 64;
const mobileSampleCount = 40;
const desktopViewportWidth = 1024;
const playbackVisualizerFps = 30;
const reducedMotionVisualizerFps = 10;
const pausedVisualizerFps = 10;
const pausedDecayFactor = 0.8;
const pausedFloorAmplitude = 0.035;
const idleFloorAmplitude = 0.018;
const idleWaveCycles = 1.5;
const maximumCanvasDevicePixelRatio = 1.5;

export type PlayerAudioVisualizerRenderMode = "live" | "paused" | "idle" | "reduced-motion";

export type PlayerAudioVisualizerState = {
  samples: number[];
  isActive: boolean;
  renderMode: PlayerAudioVisualizerRenderMode;
  reducedMotion: boolean;
  maxDevicePixelRatio: number;
};

type UsePlayerAudioVisualizerInput = {
  audioRef: RefObject<HTMLAudioElement | null>;
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: PlaybackSnapshot["status"] | null | undefined;
  currentTrackId: string | null | undefined;
};

type VisualizerSourceSelection =
  | {
      kind: "local" | "remote";
      element: HTMLAudioElement;
      graphKey: string;
    }
  | {
      kind: "none";
      element: null;
      graphKey: "none";
    };

type VisualizerGraph = {
  key: string;
  context: AudioContext;
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  stream: MediaStream;
};

export function resolveVisualizerSourceSelection(input: {
  audioElement: HTMLAudioElement | null | undefined;
  remoteAudioElement: HTMLAudioElement | null | undefined;
  activePlaybackSource: ProgressivePlaybackSource;
  currentTrackId: string | null | undefined;
}) : VisualizerSourceSelection {
  if (!input.currentTrackId) {
    return {
      kind: "none",
      element: null,
      graphKey: "none"
    };
  }

  if (input.activePlaybackSource === "remote-stream") {
    return input.remoteAudioElement
      ? {
          kind: "remote",
          element: input.remoteAudioElement,
          graphKey: `${input.currentTrackId}:remote-stream:remote`
        }
      : {
          kind: "none",
          element: null,
          graphKey: "none"
        };
  }

  return input.audioElement
    ? {
        kind: "local",
        element: input.audioElement,
        graphKey: `${input.currentTrackId}:${input.activePlaybackSource}:local`
      }
    : {
        kind: "none",
        element: null,
        graphKey: "none"
      };
}

export function resolvePlayerAudioVisualizerRenderMode(input: {
  playbackStatus: PlaybackSnapshot["status"] | null | undefined;
  hasTrack: boolean;
  reducedMotion: boolean;
  hasLiveSignal: boolean;
}) : PlayerAudioVisualizerRenderMode {
  if (!input.hasTrack) {
    return "idle";
  }

  if (input.playbackStatus === "playing") {
    return input.reducedMotion ? "reduced-motion" : "live";
  }

  if (input.hasLiveSignal) {
    return input.reducedMotion ? "reduced-motion" : "paused";
  }

  return "idle";
}

export function resolvePlayerAudioVisualizerSampleCount(viewportWidth: number) {
  return viewportWidth >= desktopViewportWidth ? desktopSampleCount : mobileSampleCount;
}

export function buildIdleWaveformSamples(sampleCount: number, amplitude = idleFloorAmplitude) {
  return Array.from({ length: sampleCount }, (_, index) => {
    const progress = sampleCount <= 1 ? 0 : index / (sampleCount - 1);
    const envelope = 0.72 + 0.28 * Math.sin(progress * Math.PI);
    const wave = Math.sin(progress * Math.PI * idleWaveCycles * 2);
    return Math.max(0.01, amplitude * envelope * (0.5 + Math.abs(wave)));
  });
}

export function normalizeWaveformSamples(input: {
  timeDomainData: ArrayLike<number>;
  sampleCount: number;
  reducedMotion?: boolean;
  floorAmplitude?: number;
}) {
  const { timeDomainData, sampleCount } = input;
  if (sampleCount <= 0 || timeDomainData.length === 0) {
    return [];
  }

  const bucketSize = Math.max(1, Math.floor(timeDomainData.length / sampleCount));
  const floorAmplitude = input.floorAmplitude ?? idleFloorAmplitude;
  const normalized = new Array(sampleCount).fill(0);

  for (let index = 0; index < sampleCount; index += 1) {
    const start = index * bucketSize;
    const end =
      index === sampleCount - 1
        ? timeDomainData.length
        : Math.min(timeDomainData.length, start + bucketSize);
    let peak = 0;

    for (let cursor = start; cursor < end; cursor += 1) {
      const centered = (timeDomainData[cursor] - 128) / 128;
      peak = Math.max(peak, Math.abs(centered));
    }

    const shaped = input.reducedMotion ? peak * 0.8 : peak;
    normalized[index] = Math.max(floorAmplitude, Math.min(1, shaped));
  }

  return normalized;
}

export function decayWaveformSamples(
  samples: number[],
  factor = pausedDecayFactor,
  floorAmplitude = pausedFloorAmplitude
) {
  return samples.map((sample, index, collection) => {
    const idleTarget = buildIdleWaveformSamples(collection.length, floorAmplitude)[index] ?? floorAmplitude;
    return Math.max(idleTarget, sample * factor);
  });
}

function clampDevicePixelRatio(devicePixelRatio: number | null | undefined) {
  if (!devicePixelRatio || !Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
    return 1;
  }

  return Math.min(maximumCanvasDevicePixelRatio, devicePixelRatio);
}

function destroyVisualizerGraph(graph: VisualizerGraph | null) {
  if (!graph) {
    return;
  }

  try {
    graph.source.disconnect();
  } catch {
    // Ignore already-disconnected nodes.
  }

  try {
    graph.analyser.disconnect();
  } catch {
    // Ignore already-disconnected nodes.
  }

  void graph.context.close().catch(() => undefined);
}

function getWindowViewportWidth() {
  if (typeof window === "undefined") {
    return desktopViewportWidth;
  }

  return window.innerWidth;
}

export function usePlayerAudioVisualizer(
  input: UsePlayerAudioVisualizerInput
): PlayerAudioVisualizerState {
  const [samples, setSamples] = useState<number[]>(() => buildIdleWaveformSamples(desktopSampleCount));
  const [isPageVisible, setIsPageVisible] = useState(
    typeof document === "undefined" ? true : !document.hidden
  );
  const [reducedMotion, setReducedMotion] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(getWindowViewportWidth);
  const graphRef = useRef<VisualizerGraph | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const timeDomainBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const sampleCount = resolvePlayerAudioVisualizerSampleCount(viewportWidth);
  const idleSamples = useMemo(() => buildIdleWaveformSamples(sampleCount), [sampleCount]);
  const sourceSelection = resolveVisualizerSourceSelection({
    audioElement: input.audioRef.current,
    remoteAudioElement: input.remoteAudioRef.current,
    activePlaybackSource: input.activePlaybackSource,
    currentTrackId: input.currentTrackId
  });
  const renderMode = resolvePlayerAudioVisualizerRenderMode({
    playbackStatus: input.playbackStatus,
    hasTrack: !!input.currentTrackId,
    reducedMotion,
    hasLiveSignal: sourceSelection.kind !== "none"
  });
  const sampleIntervalMs =
    renderMode === "reduced-motion"
      ? Math.round(1000 / reducedMotionVisualizerFps)
      : renderMode === "paused"
        ? Math.round(1000 / pausedVisualizerFps)
        : Math.round(1000 / playbackVisualizerFps);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = () => {
      setIsPageVisible(!document.hidden);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mediaQuery.matches);
    apply();

    const listener = () => apply();
    mediaQuery.addEventListener?.("change", listener);
    return () => mediaQuery.removeEventListener?.("change", listener);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    setSamples((current) => {
      if (current.length === sampleCount) {
        return current;
      }

      return buildIdleWaveformSamples(sampleCount);
    });
  }, [sampleCount]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
      destroyVisualizerGraph(graphRef.current);
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const stopGraphIfIdle = () => {
      if (renderMode === "idle" || !isPageVisible || sourceSelection.kind === "none") {
        destroyVisualizerGraph(graphRef.current);
        graphRef.current = null;
        timeDomainBufferRef.current = null;
      }
    };

    if (!isPageVisible) {
      stopGraphIfIdle();
      return;
    }

    let disposed = false;

    const ensureGraph = async () => {
      if (sourceSelection.kind === "none") {
        stopGraphIfIdle();
        return null;
      }

      const currentGraph = graphRef.current;
      if (currentGraph && currentGraph.key === sourceSelection.graphKey) {
        if (currentGraph.context.state === "suspended") {
          await currentGraph.context.resume().catch(() => undefined);
        }
        return currentGraph;
      }

      destroyVisualizerGraph(currentGraph);
      graphRef.current = null;
      timeDomainBufferRef.current = null;

      const stream = captureAudioStream(sourceSelection.element, {
        preferAudioContext: sourceSelection.kind === "local"
      });
      if (!stream) {
        return null;
      }

      const AudioContextCtor =
        window.AudioContext ??
        ((window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
          null);
      if (!AudioContextCtor) {
        return null;
      }

      try {
        const context = new AudioContextCtor();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = analyserFftSize;
        analyser.smoothingTimeConstant = analyserSmoothingTimeConstant;
        source.connect(analyser);
        if (context.state === "suspended") {
          await context.resume().catch(() => undefined);
        }
        const graph = {
          key: sourceSelection.graphKey,
          context,
          analyser,
          source,
          stream
        } satisfies VisualizerGraph;
        if (disposed) {
          destroyVisualizerGraph(graph);
          return null;
        }
        graphRef.current = graph;
        timeDomainBufferRef.current = new Uint8Array(new ArrayBuffer(graph.analyser.fftSize));
        return graph;
      } catch {
        return null;
      }
    };

    const scheduleNextFrame = (callback: () => void) => {
      timeoutRef.current = window.setTimeout(() => {
        animationFrameRef.current = window.requestAnimationFrame(callback);
      }, sampleIntervalMs);
    };

    const sampleLive = async () => {
      if (disposed) {
        return;
      }

      if (renderMode !== "live" && renderMode !== "reduced-motion") {
        scheduleNextFrame(tick);
        return;
      }

      const graph = await ensureGraph();
      const timeDomainBuffer = timeDomainBufferRef.current;
      if (!graph || !timeDomainBuffer) {
        setSamples(idleSamples);
        scheduleNextFrame(tick);
        return;
      }

      graph.analyser.getByteTimeDomainData(timeDomainBuffer);
      setSamples(
        normalizeWaveformSamples({
          timeDomainData: timeDomainBuffer,
          sampleCount,
          reducedMotion: renderMode === "reduced-motion"
        })
      );
      scheduleNextFrame(tick);
    };

    const tickPaused = () => {
      if (disposed) {
        return;
      }

      setSamples((current) =>
        current.length === sampleCount
          ? decayWaveformSamples(current, pausedDecayFactor, pausedFloorAmplitude)
          : buildIdleWaveformSamples(sampleCount, pausedFloorAmplitude)
      );
      scheduleNextFrame(tick);
    };

    const tickIdle = () => {
      if (disposed) {
        return;
      }

      stopGraphIfIdle();
      setSamples(idleSamples);
    };

    const tick = () => {
      if (renderMode === "live" || renderMode === "reduced-motion") {
        void sampleLive();
        return;
      }

      if (renderMode === "paused") {
        tickPaused();
        return;
      }

      tickIdle();
    };

    tick();

    return () => {
      disposed = true;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      stopGraphIfIdle();
    };
  }, [
    idleSamples,
    input.playbackStatus,
    isPageVisible,
    renderMode,
    sampleCount,
    sampleIntervalMs,
    sourceSelection.graphKey,
    sourceSelection.kind
  ]);

  return {
    samples,
    isActive: isPageVisible && (renderMode === "live" || renderMode === "reduced-motion"),
    renderMode,
    reducedMotion,
    maxDevicePixelRatio: clampDevicePixelRatio(
      typeof window === "undefined" ? 1 : window.devicePixelRatio
    )
  };
}
