"use client";

import { useEffect, useRef } from "react";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function sampleWindowEnergy(samples: number[], center: number, radius: number) {
  if (samples.length === 0) {
    return 0;
  }

  const start = Math.max(0, Math.floor(center - radius));
  const end = Math.min(samples.length, Math.ceil(center + radius + 1));
  let sum = 0;
  let peak = 0;
  let count = 0;

  for (let index = start; index < end; index += 1) {
    const value = Math.max(0, samples[index] ?? 0);
    sum += value;
    peak = Math.max(peak, value);
    count += 1;
  }

  if (count === 0) {
    return 0;
  }

  const average = sum / count;
  return average * 0.62 + peak * 0.38;
}

function resolveSectionBoost(progress: number) {
  const phaseA = Math.sin(progress * Math.PI * 2.2) * 0.06;
  const phaseB = Math.sin(progress * Math.PI * 5.4 + 0.8) * 0.035;
  const shoulder = 0.84 + 0.16 * Math.sin(progress * Math.PI);
  return shoulder + phaseA + phaseB;
}

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
      const safeProgressRatio = Math.min(Math.max(progressRatio, 0), 1);
      const isCompact = width < 640;
      const outerPadding = isCompact ? 6 : 8;
      const usableWidth = Math.max(1, width - outerPadding * 2);
      const targetBarCount = Math.max(
        isCompact ? 22 : 30,
        Math.min(isCompact ? 46 : 74, Math.floor(width / (reducedMotion ? (isCompact ? 16 : 14) : isCompact ? 12 : 10)))
      );
      const barCount = Math.min(targetBarCount, Math.max(1, samples.length));
      const gap = reducedMotion ? (isCompact ? 2.25 : 2) : isCompact ? 1.8 : 1.5;
      const barWidth = Math.max(2, usableWidth / Math.max(1, barCount) - gap);
      const stride = samples.length / Math.max(1, barCount);
      const progressX = width * safeProgressRatio;
      const activeMaxHeight = height * (isPlaying ? (isCompact ? 0.82 : 0.92) : isCompact ? 0.56 : 0.64);
      const idleFloorHeight = Math.max(isCompact ? 2 : 2.4, height * (isCompact ? 0.15 : 0.18));
      const averageEnergy =
        samples.length > 0
          ? samples.reduce((sum, sample) => sum + Math.max(0, sample), 0) / samples.length
          : 0;
      const peakEnergy = samples.reduce((peak, sample) => Math.max(peak, sample ?? 0), 0);
      const scanGlowWidth = Math.max(isCompact ? 22 : 28, width * (isCompact ? 0.065 : 0.08));
      const hotspotRadius = Math.max(isCompact ? 9 : 12, height * (isCompact ? 0.9 : 1.1) + peakEnergy * height * 0.9);

      context.clearRect(0, 0, width, height);
      const laneGradient = context.createLinearGradient(0, 0, width, 0);
      laneGradient.addColorStop(0, "rgba(255,255,255,0)");
      laneGradient.addColorStop(0.18, "rgba(103,161,255,0.05)");
      laneGradient.addColorStop(0.5, "rgba(37,99,235,0.1)");
      laneGradient.addColorStop(0.82, "rgba(103,161,255,0.05)");
      laneGradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = laneGradient;
      context.fillRect(0, Math.max(0, baseline - height * 0.2), width, Math.max(1, height * 0.4));

      const spineGradient = context.createLinearGradient(0, 0, width, 0);
      spineGradient.addColorStop(0, "rgba(125, 211, 252, 0.04)");
      spineGradient.addColorStop(0.5, "rgba(96, 165, 250, 0.22)");
      spineGradient.addColorStop(1, "rgba(125, 211, 252, 0.04)");
      context.strokeStyle = spineGradient;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, baseline);
      context.lineTo(width, baseline);
      context.stroke();

      const topMistGradient = context.createLinearGradient(0, 0, 0, height);
      topMistGradient.addColorStop(0, "rgba(125, 211, 252, 0.08)");
      topMistGradient.addColorStop(0.42, "rgba(56, 189, 248, 0.02)");
      topMistGradient.addColorStop(1, "rgba(2, 6, 23, 0)");
      context.fillStyle = topMistGradient;
      context.fillRect(0, 0, width, height);

      for (let index = 0; index < barCount; index += 1) {
        const bandProgress = index / Math.max(1, barCount - 1);
        const sampleIndex = index * stride + stride * 0.5;
        const localRadius = Math.max(0.9, stride * (isCompact ? 1.2 : 1.45));
        const sample = Math.max(0.012, sampleWindowEnergy(samples, sampleIndex, localRadius));
        const envelope = resolveSectionBoost(bandProgress);
        const pulse = reducedMotion ? 0.94 : 1 + ((index % 7) - 3) * 0.014;
        const centerBias = 1 - Math.abs(bandProgress - safeProgressRatio);
        const progressBias = 1 + clamp01(centerBias) * (isPlaying ? 0.08 : 0.04);
        const barHeight = Math.min(
          activeMaxHeight,
          idleFloorHeight + sample * activeMaxHeight * envelope * pulse * progressBias
        );
        const x = outerPadding + index * (barWidth + gap);
        const y = baseline - barHeight / 2;
        const radius = Math.min(barWidth / 2, 2.6);
        const barRight = x + barWidth;
        const isProgressed = barRight <= progressX;
        const nearPlaybackHead = Math.abs(barRight - progressX) <= scanGlowWidth * 0.75;

        const fillGradient = context.createLinearGradient(0, y, 0, y + barHeight);
        if (isProgressed) {
          fillGradient.addColorStop(0, "rgba(129, 230, 255, 0.95)");
          fillGradient.addColorStop(0.4, "rgba(56, 189, 248, 0.9)");
          fillGradient.addColorStop(1, "rgba(14, 116, 255, 0.82)");
        } else {
          fillGradient.addColorStop(0, isPlaying ? "rgba(129, 230, 255, 0.42)" : "rgba(148, 163, 184, 0.28)");
          fillGradient.addColorStop(0.45, isPlaying ? "rgba(59, 130, 246, 0.4)" : "rgba(96, 165, 250, 0.24)");
          fillGradient.addColorStop(1, isPlaying ? "rgba(15, 23, 42, 0.62)" : "rgba(15, 23, 42, 0.44)");
        }

        if (!reducedMotion) {
          context.shadowBlur = nearPlaybackHead ? 15 : isProgressed ? 11 : isCompact ? 4 : 6;
          context.shadowColor = nearPlaybackHead
            ? "rgba(191, 219, 254, 0.42)"
            : isProgressed
            ? "rgba(56, 189, 248, 0.4)"
            : "rgba(59, 130, 246, 0.18)";
        }

        context.fillStyle = fillGradient;
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, radius);
        context.fill();

        const capHeight = Math.max(1.2, barHeight * 0.12);
        const capGradient = context.createLinearGradient(0, y, 0, y + capHeight);
        capGradient.addColorStop(0, isProgressed ? "rgba(255,255,255,0.85)" : "rgba(186,230,253,0.38)");
        capGradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = capGradient;
        context.beginPath();
        context.roundRect(x, y, barWidth, capHeight, radius);
        context.fill();

        context.shadowBlur = 0;
      }

      const sweepGradient = context.createLinearGradient(0, 0, width, 0);
      sweepGradient.addColorStop(0, "rgba(255,255,255,0)");
      sweepGradient.addColorStop(Math.max(0, safeProgressRatio - 0.06), "rgba(255,255,255,0)");
      sweepGradient.addColorStop(Math.min(1, safeProgressRatio), "rgba(186,230,253,0.12)");
      sweepGradient.addColorStop(Math.min(1, safeProgressRatio + 0.04), "rgba(59,130,246,0)");
      context.fillStyle = sweepGradient;
      context.fillRect(0, 0, width, height);

      if (safeProgressRatio > 0 && safeProgressRatio < 1) {
        const scanGradient = context.createLinearGradient(
          Math.max(0, progressX - scanGlowWidth),
          0,
          Math.min(width, progressX + scanGlowWidth),
          0
        );
        scanGradient.addColorStop(0, "rgba(255,255,255,0)");
        scanGradient.addColorStop(0.4, `rgba(125, 211, 252, ${reducedMotion ? 0.08 : 0.14})`);
        scanGradient.addColorStop(0.5, `rgba(255, 255, 255, ${reducedMotion ? 0.18 : 0.28})`);
        scanGradient.addColorStop(0.6, `rgba(56, 189, 248, ${reducedMotion ? 0.1 : 0.18})`);
        scanGradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = scanGradient;
        context.fillRect(
          Math.max(0, progressX - scanGlowWidth),
          0,
          Math.min(width, scanGlowWidth * 2),
          height
        );

        context.strokeStyle = `rgba(186, 230, 253, ${reducedMotion ? 0.22 : 0.38})`;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(progressX, Math.max(0, baseline - height * 0.42));
        context.lineTo(progressX, Math.min(height, baseline + height * 0.42));
        context.stroke();
      }

      if (isPlaying && averageEnergy > 0.02) {
        const hotspotGradient = context.createRadialGradient(
          progressX,
          baseline,
          0,
          progressX,
          baseline,
          hotspotRadius
        );
        hotspotGradient.addColorStop(0, `rgba(191, 219, 254, ${0.16 + peakEnergy * 0.16})`);
        hotspotGradient.addColorStop(0.45, `rgba(56, 189, 248, ${0.08 + averageEnergy * 0.18})`);
        hotspotGradient.addColorStop(1, "rgba(14, 116, 255, 0)");
        context.fillStyle = hotspotGradient;
        context.fillRect(
          Math.max(0, progressX - hotspotRadius),
          Math.max(0, baseline - hotspotRadius),
          Math.min(width, hotspotRadius * 2),
          Math.min(height, hotspotRadius * 2)
        );
      }

      if (!reducedMotion && isPlaying && peakEnergy > 0.08) {
        const floorGlow = context.createLinearGradient(0, baseline, 0, height);
        floorGlow.addColorStop(0, `rgba(96, 165, 250, ${0.03 + averageEnergy * 0.05})`);
        floorGlow.addColorStop(1, "rgba(2, 6, 23, 0)");
        context.fillStyle = floorGlow;
        context.fillRect(0, baseline, width, height - baseline);
      }
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
      className="pointer-events-none absolute inset-x-0 top-0 h-[15px] w-full opacity-95 lg:h-[18px]"
      data-testid="player-top-waveform"
    />
  );
}
