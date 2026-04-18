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
      const baseline = height - 3;
      const safeProgressRatio = Math.min(Math.max(progressRatio, 0), 1);
      const isCompact = width < 640;
      const outerPadding = isCompact ? 10 : 14;
      const usableWidth = Math.max(1, width - outerPadding * 2);
      const targetBarCount = Math.max(
        isCompact ? 18 : 24,
        Math.min(isCompact ? 26 : 34, Math.floor(width / (isCompact ? 34 : 52)))
      );
      const barCount = Math.min(targetBarCount, Math.max(1, samples.length));
      const baseGap = isCompact ? 6 : 8;
      const gap = reducedMotion ? baseGap : baseGap * 0.9;
      const barWidth = Math.max(isCompact ? 6 : 8, usableWidth / Math.max(1, barCount) - gap);
      const stride = samples.length / Math.max(1, barCount);
      const progressX = width * safeProgressRatio;
      const activeMaxHeight = Math.max(isCompact ? 14 : 18, height * (isPlaying ? (isCompact ? 0.76 : 0.82) : isCompact ? 0.46 : 0.54));
      const idleFloorHeight = Math.max(isCompact ? 3 : 4, height * (isCompact ? 0.16 : 0.18));
      const averageEnergy =
        samples.length > 0
          ? samples.reduce((sum, sample) => sum + Math.max(0, sample), 0) / samples.length
          : 0;
      const peakEnergy = samples.reduce((peak, sample) => Math.max(peak, sample ?? 0), 0);
      const scanGlowWidth = Math.max(isCompact ? 26 : 40, width * (isCompact ? 0.07 : 0.085));
      const hotspotRadius = Math.max(isCompact ? 10 : 14, height * (isCompact ? 0.75 : 0.9) + peakEnergy * height * 0.55);

      context.clearRect(0, 0, width, height);
      const ambientGradient = context.createLinearGradient(0, 0, 0, baseline);
      ambientGradient.addColorStop(0, "rgba(125, 211, 252, 0.06)");
      ambientGradient.addColorStop(0.55, "rgba(56, 189, 248, 0.03)");
      ambientGradient.addColorStop(1, "rgba(2, 6, 23, 0)");
      context.fillStyle = ambientGradient;
      context.fillRect(0, 0, width, baseline);

      const floorLine = context.createLinearGradient(0, 0, width, 0);
      floorLine.addColorStop(0, "rgba(255,255,255,0)");
      floorLine.addColorStop(0.3, "rgba(96, 165, 250, 0.08)");
      floorLine.addColorStop(0.5, "rgba(125, 211, 252, 0.18)");
      floorLine.addColorStop(0.7, "rgba(96, 165, 250, 0.08)");
      floorLine.addColorStop(1, "rgba(255,255,255,0)");
      context.strokeStyle = floorLine;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, baseline);
      context.lineTo(width, baseline);
      context.stroke();

      for (let index = 0; index < barCount; index += 1) {
        const bandProgress = index / Math.max(1, barCount - 1);
        const sampleIndex = index * stride + stride * 0.5;
        const localRadius = Math.max(1.2, stride * (isCompact ? 1.65 : 1.9));
        const sample = Math.max(0.01, sampleWindowEnergy(samples, sampleIndex, localRadius));
        const smoothed = Math.pow(sample, 0.72);
        const envelope = resolveSectionBoost(bandProgress) * (0.92 + 0.08 * Math.sin(bandProgress * Math.PI));
        const pulse = reducedMotion ? 0.96 : 1 + ((index % 6) - 2.5) * 0.01;
        const centerBias = 1 - Math.abs(bandProgress - safeProgressRatio);
        const progressBias = 1 + clamp01(centerBias) * (isPlaying ? 0.05 : 0.02);
        const barHeight = Math.min(
          activeMaxHeight,
          idleFloorHeight + smoothed * activeMaxHeight * envelope * pulse * progressBias
        );
        const clusterGap = index > 0 && index % 4 === 0 ? gap + (isCompact ? 1.5 : 2) : gap;
        const x =
          outerPadding +
          index * (barWidth + gap) +
          Math.floor(index / 4) * (clusterGap - gap);
        const y = baseline - barHeight;
        const radius = Math.min(barWidth / 2, 3.5);
        const barRight = x + barWidth;
        const isProgressed = barRight <= progressX;
        const nearPlaybackHead = Math.abs(barRight - progressX) <= scanGlowWidth * 0.65;

        const shellGradient = context.createLinearGradient(0, y, 0, y + barHeight);
        shellGradient.addColorStop(0, "rgba(255,255,255,0.08)");
        shellGradient.addColorStop(0.32, "rgba(30, 41, 59, 0.4)");
        shellGradient.addColorStop(1, "rgba(2, 6, 23, 0.68)");
        context.fillStyle = shellGradient;
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, radius);
        context.fill();

        const fillGradient = context.createLinearGradient(0, y, 0, y + barHeight);
        if (isProgressed) {
          fillGradient.addColorStop(0, "rgba(219, 234, 254, 0.88)");
          fillGradient.addColorStop(0.32, "rgba(125, 211, 252, 0.9)");
          fillGradient.addColorStop(0.72, "rgba(56, 189, 248, 0.82)");
          fillGradient.addColorStop(1, "rgba(29, 78, 216, 0.66)");
        } else {
          fillGradient.addColorStop(0, isPlaying ? "rgba(191, 219, 254, 0.22)" : "rgba(148, 163, 184, 0.16)");
          fillGradient.addColorStop(0.48, isPlaying ? "rgba(59, 130, 246, 0.18)" : "rgba(71, 85, 105, 0.18)");
          fillGradient.addColorStop(1, "rgba(15, 23, 42, 0.08)");
        }

        if (!reducedMotion) {
          context.shadowBlur = nearPlaybackHead ? 18 : isProgressed ? 12 : isCompact ? 3 : 5;
          context.shadowColor = nearPlaybackHead
            ? "rgba(191, 219, 254, 0.28)"
            : isProgressed
            ? "rgba(56, 189, 248, 0.22)"
            : "rgba(59, 130, 246, 0.08)";
        }

        context.fillStyle = fillGradient;
        context.beginPath();
        context.roundRect(x + 0.5, y + 0.5, Math.max(1, barWidth - 1), Math.max(1, barHeight - 1), radius);
        context.fill();

        const capHeight = Math.max(1.1, barHeight * 0.1);
        const capGradient = context.createLinearGradient(0, y, 0, y + capHeight);
        capGradient.addColorStop(0, isProgressed ? "rgba(255,255,255,0.48)" : "rgba(255,255,255,0.16)");
        capGradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = capGradient;
        context.beginPath();
        context.roundRect(x + 0.5, y + 0.5, Math.max(1, barWidth - 1), capHeight, radius);
        context.fill();

        if (isProgressed) {
          const reflectionGradient = context.createLinearGradient(0, y, 0, baseline);
          reflectionGradient.addColorStop(0, "rgba(191, 219, 254, 0.08)");
          reflectionGradient.addColorStop(1, "rgba(191, 219, 254, 0)");
          context.fillStyle = reflectionGradient;
          context.fillRect(x, baseline, barWidth, Math.min(6, height - baseline));
        }

        context.shadowBlur = 0;
      }

      if (safeProgressRatio > 0 && safeProgressRatio < 1) {
        const scanGradient = context.createLinearGradient(
          Math.max(0, progressX - scanGlowWidth),
          0,
          Math.min(width, progressX + scanGlowWidth),
          0
        );
        scanGradient.addColorStop(0, "rgba(255,255,255,0)");
        scanGradient.addColorStop(0.38, `rgba(125, 211, 252, ${reducedMotion ? 0.05 : 0.09})`);
        scanGradient.addColorStop(0.5, `rgba(255, 255, 255, ${reducedMotion ? 0.1 : 0.16})`);
        scanGradient.addColorStop(0.62, `rgba(56, 189, 248, ${reducedMotion ? 0.06 : 0.1})`);
        scanGradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = scanGradient;
        context.fillRect(
          Math.max(0, progressX - scanGlowWidth),
          0,
          Math.min(width, scanGlowWidth * 2),
          height
        );
      }

      if (isPlaying && averageEnergy > 0.02) {
        const hotspotGradient = context.createRadialGradient(
          progressX,
          Math.max(4, baseline - 4),
          0,
          progressX,
          Math.max(4, baseline - 4),
          hotspotRadius
        );
        hotspotGradient.addColorStop(0, `rgba(191, 219, 254, ${0.1 + peakEnergy * 0.08})`);
        hotspotGradient.addColorStop(0.45, `rgba(56, 189, 248, ${0.04 + averageEnergy * 0.1})`);
        hotspotGradient.addColorStop(1, "rgba(14, 116, 255, 0)");
        context.fillStyle = hotspotGradient;
        context.fillRect(
          Math.max(0, progressX - hotspotRadius),
          Math.max(0, baseline - hotspotRadius - 4),
          Math.min(width, hotspotRadius * 2),
          Math.min(height, hotspotRadius * 2)
        );
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
      className="pointer-events-none absolute inset-x-0 top-[-18px] h-[20px] w-full opacity-95 lg:top-[-22px] lg:h-[24px]"
      data-testid="player-top-waveform"
    />
  );
}
