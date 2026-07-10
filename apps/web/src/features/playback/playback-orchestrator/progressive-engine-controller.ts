"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from "react";
import { ProgressiveMseEngine } from "../progressive-mse-engine";
import { ProgressivePcmEngine } from "../progressive-pcm-engine";
import {
  type ProgressiveEngineType,
  type ProgressiveTrackManifest
} from "../progressive-playback";
import { roomAudioOutput } from "../room-audio-output";
import {
  resolveProgressiveEngineAttachErrorAction,
  resolveProgressiveEngineAttachResultAction,
  resolveProgressiveEngineAttachSuccessFallbackReason,
  resolveProgressiveEngineSetupPreflight
} from "./pipeline";

type ProgressiveEngineControllerInput = {
  audioRef: RefObject<HTMLAudioElement | null>;
  canPrepareProgressiveLocal: boolean;
  currentProgressiveEngineType: ProgressiveEngineType;
  currentProgressiveManifest: ProgressiveTrackManifest | null;
  markPcmRuntimeFailure: (reason: string | null | undefined) => void;
  peerId: string;
  progressiveEngineRef: MutableRefObject<ProgressiveMseEngine | null>;
  progressivePcmEngineRef: MutableRefObject<ProgressivePcmEngine | null>;
  setProgressiveFallbackReason: Dispatch<SetStateAction<string | null>>;
  volume: number;
};

export function shouldRecoverMissingProgressiveEngine(input: {
  canPrepareProgressiveLocal: boolean;
  hasManifest: boolean;
  hasAudio: boolean;
  hasMseEngine: boolean;
  hasPcmEngine: boolean;
}) {
  return (
    input.canPrepareProgressiveLocal &&
    input.hasManifest &&
    input.hasAudio &&
    !input.hasMseEngine &&
    !input.hasPcmEngine
  );
}

export function useProgressiveEngineController({
  audioRef,
  canPrepareProgressiveLocal,
  currentProgressiveEngineType,
  currentProgressiveManifest,
  markPcmRuntimeFailure,
  peerId,
  progressiveEngineRef,
  progressivePcmEngineRef,
  setProgressiveFallbackReason,
  volume
}: ProgressiveEngineControllerInput) {
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const markPcmRuntimeFailureRef = useRef(markPcmRuntimeFailure);
  markPcmRuntimeFailureRef.current = markPcmRuntimeFailure;
  const [recoveryGeneration, setRecoveryGeneration] = useState(0);

  useEffect(() => {
    if (!canPrepareProgressiveLocal || !currentProgressiveManifest) {
      return;
    }

    const timerId = window.setInterval(() => {
      if (
        shouldRecoverMissingProgressiveEngine({
          canPrepareProgressiveLocal,
          hasManifest: !!currentProgressiveManifest,
          hasAudio: !!audioRef.current,
          hasMseEngine: !!progressiveEngineRef.current,
          hasPcmEngine: !!progressivePcmEngineRef.current
        })
      ) {
        setRecoveryGeneration((current) => current + 1);
      }
    }, 500);

    return () => {
      window.clearInterval(timerId);
    };
  }, [
    audioRef,
    canPrepareProgressiveLocal,
    currentProgressiveManifest,
    progressiveEngineRef,
    progressivePcmEngineRef
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    const setupPreflight = resolveProgressiveEngineSetupPreflight({
      hasAudio: !!audio,
      canPrepareProgressiveLocal,
      hasManifest: !!currentProgressiveManifest
    });
    if (setupPreflight === "skip") {
      return;
    }

    progressiveEngineRef.current?.destroy();
    progressiveEngineRef.current = null;
    progressivePcmEngineRef.current?.destroy();
    progressivePcmEngineRef.current = null;
    if (setupPreflight === "destroy-existing" || !audio || !currentProgressiveManifest) {
      return;
    }

    const engine =
      currentProgressiveEngineType === "pcm"
        ? new ProgressivePcmEngine(
            audio,
            peerId,
            currentProgressiveManifest,
            () => roomAudioOutput.getSharedAudioContext()
          )
        : new ProgressiveMseEngine(audio, peerId, currentProgressiveManifest);

    if (engine instanceof ProgressivePcmEngine) {
      progressivePcmEngineRef.current = engine;
      engine.setVolume(volumeRef.current);
    } else {
      progressiveEngineRef.current = engine;
    }

    void engine
      .attach()
      .then((attached) => {
        const attachAction = resolveProgressiveEngineAttachResultAction({
          isCurrentEngine:
            progressiveEngineRef.current === engine || progressivePcmEngineRef.current === engine,
          attached,
          isPcmEngine: engine instanceof ProgressivePcmEngine
        });
        if (!attachAction) {
          return;
        }

        if (attachAction.kind === "failure") {
          if (attachAction.failureAction === "pcm-runtime-failure") {
            markPcmRuntimeFailureRef.current("engine-failed");
          } else {
            setProgressiveFallbackReason(attachAction.failureAction);
          }
          return;
        }

        setProgressiveFallbackReason(resolveProgressiveEngineAttachSuccessFallbackReason);
        if (attachAction.shouldSyncEngine) {
          void engine.sync();
        }
        return undefined;
      })
      .catch(() => {
        const attachAction = resolveProgressiveEngineAttachErrorAction({
          isCurrentEngine:
            progressiveEngineRef.current === engine || progressivePcmEngineRef.current === engine,
          isPcmEngine: engine instanceof ProgressivePcmEngine
        });
        if (!attachAction) {
          return;
        }

        if (attachAction.failureAction === "pcm-runtime-failure") {
          markPcmRuntimeFailureRef.current("engine-failed");
        } else {
          setProgressiveFallbackReason(attachAction.failureAction);
        }
      });

    return () => {
      if (progressiveEngineRef.current === engine) {
        progressiveEngineRef.current = null;
      }
      if (progressivePcmEngineRef.current === engine) {
        progressivePcmEngineRef.current = null;
      }
      engine.destroy();
    };
  }, [
    audioRef,
    canPrepareProgressiveLocal,
    currentProgressiveManifest,
    currentProgressiveEngineType,
    peerId,
    progressiveEngineRef,
    progressivePcmEngineRef,
    recoveryGeneration,
    setProgressiveFallbackReason
  ]);

  useEffect(() => {
    progressivePcmEngineRef.current?.setVolume(volume);
  }, [progressivePcmEngineRef, volume]);
}
