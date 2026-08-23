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
 * Performance: Pure hardware-accelerated CSS + static crisp SVG (zero feGaussianBlur filters)
 */
export function InteractiveStarfieldScene({ className = "" }: { className?: string }) {
  const stars = [
    { x: "14%", y: "24%", r: 1.5 },
    { x: "28%", y: "18%", r: 2 },
    { x: "65%", y: "15%", r: 2 },
    { x: "82%", y: "28%", r: 1.5 },
    { x: "74%", y: "68%", r: 1.8 },
    { x: "35%", y: "75%", r: 1.2 },
    { x: "88%", y: "82%", r: 1.2 }
  ];

  return (
    <div
      aria-hidden="true"
      className={`relative w-full h-full overflow-hidden bg-[radial-gradient(ellipse_at_50%_20%,#0f172a_0%,#090d16_55%,#04060a_100%)] select-none [contain:layout_paint] ${className}`}
    >
      {/* Deep Ambient Aurora Glow (GPU accelerated layer) */}
      <div className="absolute -top-1/4 left-1/4 w-3/5 h-4/5 rounded-full bg-[radial-gradient(circle,#0070f328_0%,#38bdf812_45%,transparent_70%)] blur-xl pointer-events-none" />
      <div className="absolute -bottom-1/3 right-1/6 w-1/2 h-3/4 rounded-full bg-[radial-gradient(circle,#6366f120_0%,transparent_65%)] blur-lg pointer-events-none" />

      {/* SVG Canvas for Stars and Wave Arcs */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="interactiveWaveGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.15" />
            <stop offset="50%" stopColor="#60a5fa" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#818cf8" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="interactiveWaveGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#a855f7" stopOpacity="0.1" />
            <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#0070f3" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* Constellation Connection Line */}
        <path
          d="M 65% 15% L 82% 28% L 74% 68%"
          fill="none"
          stroke="rgba(147, 197, 253, 0.2)"
          strokeWidth="0.75"
          strokeDasharray="3 3"
        />

        {/* Sinusoidal Intersecting Resonance Soundwaves */}
        <path
          d="M -10 65 Q 60 25, 140 55 T 300 45"
          fill="none"
          stroke="url(#interactiveWaveGrad1)"
          strokeWidth="1.75"
          className="opacity-80 group-hover:opacity-100 transition-opacity duration-300"
        />
        <path
          d="M -10 40 Q 80 75, 170 35 T 320 60"
          fill="none"
          stroke="url(#interactiveWaveGrad2)"
          strokeWidth="1.5"
          className="opacity-65 group-hover:opacity-90 transition-opacity duration-300"
        />

        {/* Starfield Particles (Crisp, zero-filter for instant rendering) */}
        {stars.map((star, i) => (
          <circle
            key={i}
            cx={star.x}
            cy={star.y}
            r={star.r}
            fill="#ffffff"
            className="opacity-75 group-hover:opacity-100 full-motion-twinkle transition-opacity duration-300"
          />
        ))}

        {/* Diamond Starburst Sparkles */}
        <g transform="translate(68, 22) scale(0.9)" className="opacity-80 group-hover:opacity-100 transition-opacity duration-300">
          <path d="M 0,-6 L 1.5,-1.5 L 6,0 L 1.5,1.5 L 0,6 L -1.5,1.5 L -6,0 L -1.5,-1.5 Z" fill="#e0f2fe" />
        </g>
        <g transform="translate(210, 26) scale(0.75)" className="opacity-70 group-hover:opacity-100 transition-opacity duration-300">
          <path d="M 0,-6 L 1.5,-1.5 L 6,0 L 1.5,1.5 L 0,6 L -1.5,1.5 L -6,0 L -1.5,-1.5 Z" fill="#bae6fd" />
        </g>
      </svg>

      {/* Floating Center Subtle Resonance Node (Animate on card hover) */}
      <div className="absolute left-[38%] top-[46%] -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none">
        <div className="w-10 h-10 rounded-full border border-blue-400/25 bg-blue-500/10 flex items-center justify-center shadow-[0_0_12px_rgba(56,189,248,0.2)] group-hover:scale-110 transition-transform duration-300">
          <div className="w-3.5 h-3.5 rounded-full bg-blue-300/40 group-hover:animate-ping full-motion-ping opacity-60" />
          <div className="absolute w-2 h-2 rounded-full bg-white shadow-[0_0_6px_#ffffff]" />
        </div>
      </div>

      {/* Subtle Bottom Vignette */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#04060a]/80 via-transparent to-transparent pointer-events-none" />
    </div>
  );
}

/**
 * 2. Request Room Scene: Neon Nebula & Floating Vinyl Record (点歌房 · 霓虹星云与流光黑胶)
 * Performance: Vinyl rotation activates on hover or full motion mode
 */
export function RequestNebulaVinylScene({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`relative w-full h-full overflow-hidden bg-[radial-gradient(ellipse_at_80%_80%,#3b0764_0%,#1e0538_50%,#090214_100%)] select-none [contain:layout_paint] ${className}`}
    >
      {/* Nebula Ambient Glows */}
      <div className="absolute -left-1/6 top-1/4 w-3/5 h-4/5 rounded-full bg-[radial-gradient(circle,#c026d325_0%,#e879f910_50%,transparent_75%)] blur-xl pointer-events-none" />
      <div className="absolute right-[-10%] bottom-[-20%] w-3/5 h-4/5 rounded-full bg-[radial-gradient(circle,#ec489925_0%,transparent_65%)] blur-lg pointer-events-none" />

      {/* Floating 3D Vinyl Record (Animates on hover or full motion mode) */}
      <div className="absolute -right-4 -bottom-8 w-40 h-40 sm:w-44 sm:h-44 group-hover:scale-105 transition-transform duration-500 ease-out">
        <svg
          viewBox="0 0 160 160"
          className="w-full h-full drop-shadow-[0_0_20px_rgba(217,70,239,0.3)] group-hover:animate-spin-slow full-motion-spin will-change-transform"
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
          <circle cx="80" cy="80" r="68" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.75" />
          <circle cx="80" cy="80" r="56" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.75" />
          <circle cx="80" cy="80" r="44" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.75" />

          {/* Specular Reflective Highlight Wedges */}
          <path d="M 80,80 L 140,40 A 76,76 0 0,0 110,12 Z" fill="url(#specularWedge)" />
          <path d="M 80,80 L 20,120 A 76,76 0 0,0 50,148 Z" fill="url(#specularWedge)" />

          {/* Center Record Label */}
          <circle cx="80" cy="80" r="24" fill="url(#vinylLabel)" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
          <circle cx="80" cy="80" r="21" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" />
          <circle cx="80" cy="80" r="6" fill="#090214" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
        </svg>
      </div>

      {/* Floating Decorative Music Notes */}
      <div className="absolute inset-0 pointer-events-none">
        <span className="absolute left-[16%] top-[24%] text-2xl font-light text-fuchsia-200/80 drop-shadow-[0_0_8px_rgba(232,121,249,0.6)] group-hover:translate-y-[-2px] transition-transform duration-300">
          ♪
        </span>
        <span className="absolute left-[32%] top-[56%] text-lg font-light text-pink-300/60 drop-shadow-[0_0_6px_rgba(244,114,182,0.5)] group-hover:translate-y-[-1px] transition-transform duration-300">
          ♫
        </span>
        <span className="absolute left-[24%] top-[68%] h-1.5 w-1.5 rounded-full bg-pink-200/70 shadow-[0_0_6px_rgba(244,114,182,0.8)]" />
        <span className="absolute left-[44%] top-[30%] h-1 w-1 rounded-full bg-fuchsia-200/70 shadow-[0_0_6px_rgba(232,121,249,0.8)]" />
      </div>

      {/* Subtle Bottom Darkening */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#090214]/70 via-transparent to-transparent pointer-events-none" />
    </div>
  );
}

/**
 * 3. Radio Room Scene: Aurora Broadcast & Concentric Radial Waves (自由电台 · 极光同心辐射)
 * Performance: Static elegant rings in idle, smooth pulse on hover or full motion mode
 */
export function RadioAuroraPulseScene({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`relative w-full h-full overflow-hidden bg-[radial-gradient(ellipse_at_50%_50%,#042f2e_0%,#083344_45%,#02141a_100%)] select-none [contain:layout_paint] ${className}`}
    >
      {/* Aurora Ambient Glow Bands */}
      <div className="absolute -top-1/3 left-1/5 w-3/5 h-3/4 rounded-full bg-[radial-gradient(circle,#00a9d625_0%,#14b8a614_50%,transparent_75%)] blur-xl pointer-events-none" />
      <div className="absolute -bottom-1/4 right-1/4 w-1/2 h-2/3 rounded-full bg-[radial-gradient(circle,#f59e0b18_0%,transparent_65%)] blur-lg pointer-events-none" />

      {/* Concentric Radial Resonance Soundwaves (Static by default, active on hover or full motion) */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="auroraWaveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.15" />
            <stop offset="50%" stopColor="#00a9d6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* Flowing Aurora Wave Ribbons in Background */}
        <path
          d="M -20 60 C 80 20, 160 85, 320 35"
          fill="none"
          stroke="url(#auroraWaveGrad)"
          strokeWidth="2"
          className="opacity-70 group-hover:opacity-95 transition-opacity duration-300"
        />
        <path
          d="M -20 45 C 90 75, 180 15, 320 55"
          fill="none"
          stroke="rgba(45, 212, 191, 0.4)"
          strokeWidth="1.25"
          strokeDasharray="4 4"
        />

        {/* 3 Crisp Concentric Static/Hover/FullMotion Rings */}
        <circle
          cx="50%"
          cy="50%"
          r="22%"
          fill="none"
          stroke="#00a9d6"
          strokeOpacity="0.3"
          strokeWidth="1"
          className="group-hover:stroke-opacity-60 full-motion-pulse transition-all duration-300"
        />
        <circle
          cx="50%"
          cy="50%"
          r="38%"
          fill="none"
          stroke="#2dd4bf"
          strokeOpacity="0.2"
          strokeWidth="1"
          className="group-hover:stroke-opacity-50 full-motion-pulse transition-all duration-300"
        />
        <circle
          cx="50%"
          cy="50%"
          r="54%"
          fill="none"
          stroke="#38bdf8"
          strokeOpacity="0.12"
          strokeWidth="0.75"
          className="group-hover:stroke-opacity-35 full-motion-pulse transition-all duration-300"
        />

        {/* Acoustic Dust Nodes */}
        <circle cx="18%" cy="30%" r="1.5" fill="#a7f3d0" opacity="0.6" />
        <circle cx="68%" cy="25%" r="1.5" fill="#a7f3d0" opacity="0.7" />
        <circle cx="84%" cy="60%" r="1.2" fill="#a7f3d0" opacity="0.5" />
      </svg>

      {/* Central Radio Transmitter Beacon Node */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none">
        <div className="relative flex items-center justify-center w-9 h-9 rounded-full border border-teal-300/40 bg-teal-950/60 shadow-[0_0_15px_rgba(20,184,166,0.5)] group-hover:scale-110 transition-transform duration-300">
          <div className="w-4 h-4 rounded-full border border-amber-300/60 bg-amber-400/25 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_#ffffff]" />
          </div>
        </div>
      </div>

      {/* Subtle Radio Wave Broadcast Notes */}
      <span className="absolute left-[22%] top-[24%] text-2xl font-light text-teal-100/70 drop-shadow-[0_0_8px_rgba(45,212,191,0.6)] pointer-events-none group-hover:translate-y-[-2px] transition-transform duration-300">
        ♪
      </span>
      <span className="absolute right-[22%] bottom-[24%] text-lg font-light text-amber-200/60 drop-shadow-[0_0_6px_rgba(251,191,36,0.5)] pointer-events-none group-hover:translate-y-[-1px] transition-transform duration-300">
        ♪
      </span>

      {/* Subtle Bottom Vignette */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#02141a]/80 via-transparent to-transparent pointer-events-none" />
    </div>
  );
}
