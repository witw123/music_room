"use client";

import type { RoomType } from "@music-room/shared";

type ArtisticRoomStageSceneProps = {
  roomType: RoomType;
  className?: string;
};

export function ArtisticRoomStageScene({ roomType, className = "" }: ArtisticRoomStageSceneProps) {
  if (roomType === "request") return <RequestNebulaVinylScene className={className} />;
  if (roomType === "radio") return <RadioAuroraPulseScene className={className} />;
  return <InteractiveStarfieldScene className={className} />;
}

/**
 * 1. Interactive Room Scene: Cosmic Starfield & Resonance Waves (多人互动房 · 星空共鸣)
 */
export function InteractiveStarfieldScene({ className = "" }: { className?: string }) {
  const stars = [
    { x: "12%", y: "22%", r: 1.5, delay: "0.2s", dur: "3.2s" },
    { x: "28%", y: "18%", r: 2, delay: "1.1s", dur: "2.8s" },
    { x: "42%", y: "30%", r: 1, delay: "0.7s", dur: "4s" },
    { x: "65%", y: "15%", r: 2.2, delay: "1.8s", dur: "3.5s" },
    { x: "82%", y: "28%", r: 1.5, delay: "0.4s", dur: "2.6s" },
    { x: "92%", y: "18%", r: 1.2, delay: "1.3s", dur: "3.8s" },
    { x: "18%", y: "65%", r: 1.8, delay: "1.5s", dur: "3.1s" },
    { x: "35%", y: "75%", r: 1, delay: "0.9s", dur: "4.2s" },
    { x: "74%", y: "68%", r: 2, delay: "0.1s", dur: "3s" },
    { x: "88%", y: "82%", r: 1.2, delay: "1.7s", dur: "3.6s" },
    { x: "50%", y: "12%", r: 1.2, delay: "2.2s", dur: "3.9s" }
  ];

  return (
    <div
      aria-hidden="true"
      className={`relative w-full h-full overflow-hidden bg-[radial-gradient(ellipse_at_50%_20%,#0f172a_0%,#090d16_55%,#04060a_100%)] select-none ${className}`}
    >
      {/* Deep Ambient Aurora Glow */}
      <div className="absolute -top-1/4 left-1/4 w-3/5 h-4/5 rounded-full bg-[radial-gradient(circle,#0070f333_0%,#38bdf815_45%,transparent_70%)] blur-xl" />
      <div className="absolute -bottom-1/3 right-1/6 w-1/2 h-3/4 rounded-full bg-[radial-gradient(circle,#6366f125_0%,transparent_65%)] blur-lg" />

      {/* SVG Canvas for Stars, Wave Arcs, and Diamond Sparkles */}
      <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="interactiveWaveGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.1" />
            <stop offset="50%" stopColor="#60a5fa" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#818cf8" stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id="interactiveWaveGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#a855f7" stopOpacity="0.1" />
            <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#0070f3" stopOpacity="0.1" />
          </linearGradient>
          <filter id="starGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Constellation Connection Line */}
        <path
          d="M 65% 15% L 82% 28% L 74% 68%"
          fill="none"
          stroke="rgba(147, 197, 253, 0.18)"
          strokeWidth="0.75"
          strokeDasharray="3 3"
        />

        {/* Sinusoidal Intersecting Resonance Soundwaves */}
        <path
          d="M -10 65 Q 60 25, 140 55 T 300 45"
          fill="none"
          stroke="url(#interactiveWaveGrad1)"
          strokeWidth="1.75"
          className="opacity-75"
        />
        <path
          d="M -10 40 Q 80 75, 170 35 T 320 60"
          fill="none"
          stroke="url(#interactiveWaveGrad2)"
          strokeWidth="1.5"
          className="opacity-60"
        />

        {/* Starfield Particles with Staggered Breathing Animation */}
        {stars.map((star, i) => (
          <circle
            key={i}
            cx={star.x}
            cy={star.y}
            r={star.r}
            fill="#ffffff"
            filter="url(#starGlow)"
            style={{
              animation: `twinkleStar ${star.dur} ease-in-out infinite`,
              animationDelay: star.delay,
              transformOrigin: `${star.x} ${star.y}`
            }}
          />
        ))}

        {/* Diamond Starburst Sparkles */}
        <g transform="translate(68, 22) scale(0.9)" filter="url(#starGlow)">
          <path d="M 0,-6 L 1.5,-1.5 L 6,0 L 1.5,1.5 L 0,6 L -1.5,1.5 L -6,0 L -1.5,-1.5 Z" fill="#e0f2fe" />
        </g>
        <g transform="translate(210, 26) scale(0.75)" filter="url(#starGlow)">
          <path d="M 0,-6 L 1.5,-1.5 L 6,0 L 1.5,1.5 L 0,6 L -1.5,1.5 L -6,0 L -1.5,-1.5 Z" fill="#bae6fd" />
        </g>
      </svg>

      {/* Floating Center Subtle Resonance Node */}
      <div className="absolute left-[38%] top-[46%] -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none">
        <div className="w-12 h-12 rounded-full border border-blue-400/20 bg-blue-500/10 backdrop-blur-xs flex items-center justify-center shadow-[0_0_15px_rgba(56,189,248,0.25)]">
          <div className="w-4 h-4 rounded-full bg-blue-300/40 animate-ping opacity-60" />
          <div className="absolute w-2 h-2 rounded-full bg-white shadow-[0_0_8px_#ffffff]" />
        </div>
      </div>

      {/* Subtle Bottom Vignette */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#04060a]/80 via-transparent to-transparent pointer-events-none" />
    </div>
  );
}

/**
 * 2. Request Room Scene: Neon Nebula & Floating Vinyl Record (点歌房 · 霓虹星云与流光黑胶)
 */
export function RequestNebulaVinylScene({ className = "" }: { className?: string }) {
  const dustParticles = [
    { left: "15%", top: "35%", size: 3, delay: "0.2s" },
    { left: "26%", top: "68%", size: 2, delay: "1.4s" },
    { left: "38%", top: "25%", size: 2.5, delay: "0.8s" },
    { left: "48%", top: "72%", size: 3.5, delay: "2.1s" },
    { left: "58%", top: "40%", size: 2, delay: "1.7s" }
  ];

  return (
    <div
      aria-hidden="true"
      className={`relative w-full h-full overflow-hidden bg-[radial-gradient(ellipse_at_80%_80%,#3b0764_0%,#1e0538_50%,#090214_100%)] select-none ${className}`}
    >
      {/* Nebula Ambient Glows */}
      <div className="absolute -left-1/6 top-1/4 w-3/5 h-4/5 rounded-full bg-[radial-gradient(circle,#c026d333_0%,#e879f915_50%,transparent_75%)] blur-xl" />
      <div className="absolute right-[-10%] bottom-[-20%] w-3/5 h-4/5 rounded-full bg-[radial-gradient(circle,#ec489930_0%,transparent_65%)] blur-lg" />

      {/* Floating 3D Vinyl Record with Specular Sheen (Right Side) */}
      <div className="absolute -right-5 -bottom-10 w-44 h-44 sm:w-48 sm:h-48 group-hover:scale-105 transition-transform duration-500 ease-out">
        <svg
          viewBox="0 0 160 160"
          className="w-full h-full drop-shadow-[0_0_24px_rgba(217,70,239,0.35)]"
          style={{ animation: "slowVinylRotate 28s linear infinite" }}
        >
          <defs>
            <linearGradient id="vinylBody" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e142b" />
              <stop offset="50%" stopColor="#100a19" />
              <stop offset="100%" stopColor="#190e24" />
            </linearGradient>
            <linearGradient id="vinylLabel" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#c026d3" />
              <stop offset="100%" stopColor="#7e22ce" />
            </linearGradient>
            <linearGradient id="specularWedge" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
          </defs>

          {/* Vinyl Disc Body */}
          <circle cx="80" cy="80" r="76" fill="url(#vinylBody)" stroke="rgba(244,114,182,0.3)" strokeWidth="1" />

          {/* Fine Concentric Sound Grooves */}
          <circle cx="80" cy="80" r="70" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.75" />
          <circle cx="80" cy="80" r="64" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.75" />
          <circle cx="80" cy="80" r="58" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.75" />
          <circle cx="80" cy="80" r="52" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.75" />
          <circle cx="80" cy="80" r="46" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.75" />
          <circle cx="80" cy="80" r="40" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.75" />

          {/* Specular Reflective Highlight Wedges */}
          <path d="M 80,80 L 140,40 A 76,76 0 0,0 110,12 Z" fill="url(#specularWedge)" />
          <path d="M 80,80 L 20,120 A 76,76 0 0,0 50,148 Z" fill="url(#specularWedge)" />

          {/* Center Record Label */}
          <circle cx="80" cy="80" r="25" fill="url(#vinylLabel)" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
          <circle cx="80" cy="80" r="22" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" />
          <circle cx="80" cy="80" r="6" fill="#090214" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
        </svg>
      </div>

      {/* Floating Holographic Dust & Note Particles (Left Side) */}
      <div className="absolute inset-0 pointer-events-none">
        {dustParticles.map((dust, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-pink-200 shadow-[0_0_8px_rgba(244,114,182,0.8)]"
            style={{
              left: dust.left,
              top: dust.top,
              width: dust.size,
              height: dust.size,
              animation: "floatDustParticle 4s ease-in-out infinite",
              animationDelay: dust.delay
            }}
          />
        ))}

        {/* Ambient Floating Music Notes */}
        <span
          className="absolute left-[16%] top-[24%] text-2xl font-light text-fuchsia-200/80 drop-shadow-[0_0_10px_rgba(232,121,249,0.7)]"
          style={{ animation: "floatDustParticle 5.5s ease-in-out infinite" }}
        >
          ♪
        </span>
        <span
          className="absolute left-[32%] top-[56%] text-lg font-light text-pink-300/60 drop-shadow-[0_0_8px_rgba(244,114,182,0.5)]"
          style={{ animation: "floatDustParticle 4.8s ease-in-out infinite 1.5s" }}
        >
          ♫
        </span>
      </div>

      {/* Subtle Bottom Darkening */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#090214]/70 via-transparent to-transparent pointer-events-none" />
    </div>
  );
}

/**
 * 3. Radio Room Scene: Aurora Broadcast & Concentric Radial Waves (自由电台 · 极光同心辐射)
 */
export function RadioAuroraPulseScene({ className = "" }: { className?: string }) {
  const acousticDust = [
    { x: "18%", y: "30%", r: 1.5, delay: "0.4s" },
    { x: "32%", y: "65%", r: 2, delay: "1.2s" },
    { x: "68%", y: "25%", r: 1.8, delay: "0.7s" },
    { x: "84%", y: "60%", r: 1.2, delay: "1.9s" },
    { x: "50%", y: "80%", r: 2.2, delay: "1.5s" }
  ];

  return (
    <div
      aria-hidden="true"
      className={`relative w-full h-full overflow-hidden bg-[radial-gradient(ellipse_at_50%_50%,#042f2e_0%,#083344_45%,#02141a_100%)] select-none ${className}`}
    >
      {/* Aurora Ambient Glow Bands */}
      <div className="absolute -top-1/3 left-1/5 w-3/5 h-3/4 rounded-full bg-[radial-gradient(circle,#00a9d630_0%,#14b8a618_50%,transparent_75%)] blur-xl" />
      <div className="absolute -bottom-1/4 right-1/4 w-1/2 h-2/3 rounded-full bg-[radial-gradient(circle,#f59e0b20_0%,transparent_65%)] blur-lg" />

      {/* Concentric Radial Resonance Soundwaves (Emitting from Center Node) */}
      <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="auroraWaveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.1" />
            <stop offset="50%" stopColor="#00a9d6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.2" />
          </linearGradient>
          <filter id="cyanGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Flowing Aurora Wave Ribbons in Background */}
        <path
          d="M -20 60 C 80 20, 160 85, 320 35"
          fill="none"
          stroke="url(#auroraWaveGrad)"
          strokeWidth="2.5"
          className="opacity-70"
        />
        <path
          d="M -20 45 C 90 75, 180 15, 320 55"
          fill="none"
          stroke="rgba(45, 212, 191, 0.45)"
          strokeWidth="1.25"
          strokeDasharray="4 4"
        />

        {/* 4 Concentric Expanding Radial Resonance Waves */}
        <circle
          cx="50%"
          cy="50%"
          fill="none"
          stroke="#00a9d6"
          filter="url(#cyanGlow)"
          style={{ animation: "pulseRadialWave 3.6s cubic-bezier(0.15, 0.85, 0.35, 1) infinite" }}
        />
        <circle
          cx="50%"
          cy="50%"
          fill="none"
          stroke="#2dd4bf"
          filter="url(#cyanGlow)"
          style={{ animation: "pulseRadialWave 3.6s cubic-bezier(0.15, 0.85, 0.35, 1) infinite 0.9s" }}
        />
        <circle
          cx="50%"
          cy="50%"
          fill="none"
          stroke="#38bdf8"
          filter="url(#cyanGlow)"
          style={{ animation: "pulseRadialWave 3.6s cubic-bezier(0.15, 0.85, 0.35, 1) infinite 1.8s" }}
        />
        <circle
          cx="50%"
          cy="50%"
          fill="none"
          stroke="#fbbf24"
          filter="url(#cyanGlow)"
          style={{ animation: "pulseRadialWave 3.6s cubic-bezier(0.15, 0.85, 0.35, 1) infinite 2.7s" }}
        />

        {/* Floating Acoustic Dust Particles */}
        {acousticDust.map((dust, i) => (
          <circle
            key={i}
            cx={dust.x}
            cy={dust.y}
            r={dust.r}
            fill="#a7f3d0"
            filter="url(#cyanGlow)"
            style={{
              animation: "floatDustParticle 4.5s ease-in-out infinite",
              animationDelay: dust.delay
            }}
          />
        ))}
      </svg>

      {/* Central Radio Transmitter Beacon Node */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none">
        <div className="relative flex items-center justify-center w-10 h-10 rounded-full border border-teal-300/40 bg-teal-950/60 backdrop-blur-xs shadow-[0_0_20px_rgba(20,184,166,0.6)]">
          <div className="w-5 h-5 rounded-full border border-amber-300/60 bg-amber-400/25 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_#ffffff]" />
          </div>
        </div>
      </div>

      {/* Subtle Radio Wave Broadcast Notes */}
      <span
        className="absolute left-[22%] top-[24%] text-2xl font-light text-teal-100/80 drop-shadow-[0_0_10px_rgba(45,212,191,0.8)] pointer-events-none"
        style={{ animation: "floatDustParticle 5s ease-in-out infinite 0.5s" }}
      >
        ♪
      </span>
      <span
        className="absolute right-[22%] bottom-[24%] text-lg font-light text-amber-200/70 drop-shadow-[0_0_8px_rgba(251,191,36,0.7)] pointer-events-none"
        style={{ animation: "floatDustParticle 4.2s ease-in-out infinite 1.8s" }}
      >
        ♪
      </span>

      {/* Subtle Bottom Vignette */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#02141a]/80 via-transparent to-transparent pointer-events-none" />
    </div>
  );
}
