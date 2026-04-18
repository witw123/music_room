"use client";

import { useEffect, useRef } from "react";

type PlayerAmbientAuraProps = {
  samples: number[];
  isPlaying: boolean;
  reducedMotion: boolean;
  maxDevicePixelRatio?: number;
};

export function PlayerAmbientAura({
  samples,
  isPlaying,
  reducedMotion,
  maxDevicePixelRatio = 1.5
}: PlayerAmbientAuraProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    let animationFrameId: number;
    let phaseOffset = 0;

    // Smoothed values for fluid animation
    let smoothedPeak = 0;
    let smoothedAverage = 0;

    const updateSize = () => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = typeof window !== "undefined" ? Math.min(maxDevicePixelRatio, window.devicePixelRatio || 1) : 1;
      const width = Math.max(1, Math.floor(bounds.width * dpr));
      const height = Math.max(1, Math.floor(bounds.height * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { width: bounds.width, height: bounds.height };
    };

    const draw = () => {
      const { width, height } = updateSize();

      let currentPeak = 0;
      let currentAverage = 0;

      if (samples.length > 0) {
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          const s = Math.max(0, samples[i]);
          sum += s;
          if (s > currentPeak) currentPeak = s;
        }
        currentAverage = sum / samples.length;
      }

      // Smooth the energy values
      smoothedPeak += (currentPeak - smoothedPeak) * (reducedMotion ? 0.05 : 0.15);
      smoothedAverage += (currentAverage - smoothedAverage) * (reducedMotion ? 0.05 : 0.1);

      // Advance phase for drifting organic movement
      if (isPlaying && !reducedMotion) {
        phaseOffset += 0.005 + smoothedAverage * 0.01;
      }

      context.clearRect(0, 0, width, height);

      // Base minimum scale when idle
      const baseScale = isPlaying ? 0.3 : 0.1;
      const boostScale = isPlaying ? 1.0 : 0;

      context.globalCompositeOperation = "screen";

      // 1. Vinyl Resonance Blob (Left)
      // Placed around x: 40-60px (where vinyl is), reacting to Peak
      const blob1Scale = baseScale + smoothedPeak * boostScale * 0.8;
      const blob1Radius = Math.max(20, width * 0.2 * blob1Scale + 40);
      const blob1X = Math.min(width * 0.15, 80) + Math.sin(phaseOffset * 1.3) * 10;
      const blob1Y = height * 0.5 + Math.cos(phaseOffset * 1.1) * 5;

      const grad1 = context.createRadialGradient(blob1X, blob1Y, 0, blob1X, blob1Y, blob1Radius);
      grad1.addColorStop(0, `rgba(56, 189, 248, ${0.4 + smoothedPeak * 0.3})`); // Cyan/Blue
      grad1.addColorStop(0.5, `rgba(59, 130, 246, ${0.15 + smoothedPeak * 0.15})`);
      grad1.addColorStop(1, "rgba(59, 130, 246, 0)");
      
      context.fillStyle = grad1;
      context.fillRect(0, 0, width, height);

      // 2. Wave Runner Blob (Moving slightly across)
      // Reacts to Average energy
      const blob2Scale = baseScale + smoothedAverage * boostScale * 1.2;
      const blob2Radius = Math.max(20, width * 0.3 * blob2Scale + 60);
      const blob2X = width * 0.5 + Math.cos(phaseOffset * 0.8) * (width * 0.2);
      const blob2Y = height * 0.5 + Math.sin(phaseOffset * 0.9) * 10;

      const grad2 = context.createRadialGradient(blob2X, blob2Y, 0, blob2X, blob2Y, blob2Radius);
      grad2.addColorStop(0, `rgba(168, 85, 247, ${0.3 + smoothedAverage * 0.3})`); // Purple
      grad2.addColorStop(0.5, `rgba(139, 92, 246, ${0.1 + smoothedAverage * 0.15})`);
      grad2.addColorStop(1, "rgba(139, 92, 246, 0)");

      context.fillStyle = grad2;
      context.fillRect(0, 0, width, height);

      // 3. Highlight Blob (Right/Accent)
      const blob3Scale = baseScale + (smoothedPeak * 0.5 + smoothedAverage * 0.5) * boostScale;
      const blob3Radius = Math.max(20, width * 0.25 * blob3Scale + 30);
      const blob3X = width * 0.8 + Math.sin(phaseOffset * 1.5) * (width * 0.1);
      const blob3Y = height * 0.5;

      const grad3 = context.createRadialGradient(blob3X, blob3Y, 0, blob3X, blob3Y, blob3Radius);
      grad3.addColorStop(0, `rgba(96, 165, 250, ${0.25 + smoothedPeak * 0.2})`); // Soft Blue
      grad3.addColorStop(1, "rgba(96, 165, 250, 0)");

      context.fillStyle = grad3;
      context.fillRect(0, 0, width, height);

      animationFrameId = requestAnimationFrame(draw);
    };

    animationFrameId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, reducedMotion, maxDevicePixelRatio, samples]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-60 mix-blend-screen transition-opacity duration-1000"
      data-testid="player-ambient-aura"
    />
  );
}
