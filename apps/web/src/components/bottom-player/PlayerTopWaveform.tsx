"use client";

import { useEffect, useRef } from "react";

type PlayerTopWaveformProps = {
  samples: number[];
  isPlaying: boolean;
  progressRatio: number;
  reducedMotion: boolean;
  maxDevicePixelRatio?: number;
};

export function PlayerTopWaveform({
  samples,
  isPlaying,
  progressRatio,
  reducedMotion,
  maxDevicePixelRatio = 1.5
}: PlayerTopWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const updateSize = () => {
      const bounds = canvas.getBoundingClientRect();
      const dpr =
        typeof window === "undefined" || !Number.isFinite(window.devicePixelRatio)
          ? 1
          : Math.min(maxDevicePixelRatio, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.floor(bounds.width * dpr));
      const height = Math.max(1, Math.floor(bounds.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      updateSize();
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      const baseline = height / 2;
      const maxAmplitude = Math.max(2, height * (isPlaying ? 0.48 : 0.32));
      const safeProgressRatio = Math.min(Math.max(progressRatio, 0), 1);

      context.clearRect(0, 0, width, height);

      const buildWavePath = () => {
        context.beginPath();
        context.moveTo(0, baseline);
        for (let index = 0; index < samples.length; index += 1) {
          const x = samples.length <= 1 ? width / 2 : (index / (samples.length - 1)) * width;
          const amplitude = maxAmplitude * Math.max(0.01, samples[index] ?? 0);
          context.lineTo(x, baseline - amplitude);
        }
        for (let index = samples.length - 1; index >= 0; index -= 1) {
          const x = samples.length <= 1 ? width / 2 : (index / (samples.length - 1)) * width;
          const amplitude = maxAmplitude * Math.max(0.01, samples[index] ?? 0);
          context.lineTo(x, baseline + amplitude);
        }
        context.closePath();
      };

      buildWavePath();
      const baseGradient = context.createLinearGradient(0, 0, width, 0);
      baseGradient.addColorStop(0, "rgba(74, 144, 226, 0.08)");
      baseGradient.addColorStop(0.5, reducedMotion ? "rgba(103, 161, 255, 0.12)" : "rgba(82, 149, 255, 0.18)");
      baseGradient.addColorStop(1, "rgba(0, 112, 243, 0.08)");
      context.fillStyle = baseGradient;
      context.fill();

      context.save();
      context.beginPath();
      context.rect(0, 0, width * safeProgressRatio, height);
      context.clip();
      buildWavePath();
      const progressGradient = context.createLinearGradient(0, 0, width, 0);
      progressGradient.addColorStop(0, "rgba(34, 197, 94, 0.16)");
      progressGradient.addColorStop(0.55, "rgba(0, 112, 243, 0.42)");
      progressGradient.addColorStop(1, "rgba(96, 165, 250, 0.18)");
      context.fillStyle = progressGradient;
      context.fill();
      context.restore();

      context.beginPath();
      context.moveTo(0, baseline);
      for (let index = 0; index < samples.length; index += 1) {
        const x = samples.length <= 1 ? width / 2 : (index / (samples.length - 1)) * width;
        const amplitude = maxAmplitude * Math.max(0.01, samples[index] ?? 0);
        context.lineTo(x, baseline - amplitude * 0.96);
      }
      context.lineWidth = reducedMotion ? 1 : 1.15;
      context.strokeStyle = isPlaying ? "rgba(125, 211, 252, 0.85)" : "rgba(96, 165, 250, 0.42)";
      if (!reducedMotion) {
        context.shadowBlur = 8;
        context.shadowColor = "rgba(59, 130, 246, 0.28)";
      }
      context.stroke();
      context.shadowBlur = 0;
    };

    draw();

    const ResizeObserverCtor =
      typeof window !== "undefined" && "ResizeObserver" in window
        ? window.ResizeObserver
        : null;
    if (ResizeObserverCtor) {
      const observer = new ResizeObserverCtor(draw);
      observer.observe(canvas);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [isPlaying, maxDevicePixelRatio, progressRatio, reducedMotion, samples]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-[14px] w-full opacity-95 lg:h-[16px]"
      data-testid="player-top-waveform"
    />
  );
}
