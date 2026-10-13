"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
};

export type TrackContextMenuProps = {
  position: { x: number; y: number } | null;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  items: ContextMenuItem[];
};

export function TrackContextMenu({
  position,
  onClose,
  title,
  subtitle,
  items
}: TrackContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!position) {
      setCoords(null);
      return;
    }

    const estimatedWidth = 180;
    const estimatedHeight = Math.max(120, items.length * 32 + (title ? 44 : 12));
    const padding = 10;
    const isMobile = window.innerWidth < 768;
    const bottomSafeMargin = isMobile ? 130 : 16;

    const clampedX = Math.max(
      padding,
      Math.min(position.x, window.innerWidth - estimatedWidth - padding)
    );

    let targetY = position.y;
    // If opening near the bottom player/navigation, open upwards
    if (position.y + estimatedHeight > window.innerHeight - bottomSafeMargin) {
      targetY = Math.max(padding, position.y - estimatedHeight);
    }
    const clampedY = Math.max(
      padding,
      Math.min(targetY, window.innerHeight - estimatedHeight - bottomSafeMargin)
    );

    setCoords({ x: clampedX, y: clampedY });
  }, [position, items.length, title]);

  useEffect(() => {
    if (!position) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const handleWindowChange = () => {
      onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleWindowChange, true);
    window.addEventListener("resize", handleWindowChange);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleWindowChange, true);
      window.removeEventListener("resize", handleWindowChange);
    };
  }, [position, onClose]);

  if (!position || !coords || typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Invisible backdrop to dismiss on click/touch outside anywhere */}
      <div
        className="fixed inset-0 z-[var(--z-modal)] cursor-default"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label="曲目快捷操作"
        className="fixed z-[calc(var(--z-modal)+1)] min-w-[176px] max-w-[240px] rounded-xl border border-surface-border bg-background-secondary p-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100 select-none"
        style={{ left: coords.x, top: coords.y }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {title ? (
          <div className="border-b border-surface-border/50 px-2.5 py-1.5 mb-1">
            <p className="truncate text-xs font-semibold text-foreground">{title}</p>
            {subtitle ? (
              <p className="truncate text-[10px] text-foreground-muted mt-0.5">{subtitle}</p>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-0.5">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-left transition-colors active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none cursor-pointer ${
                item.destructive
                  ? "text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 focus:bg-rose-500/10"
                  : "text-foreground hover:bg-surface-hover hover:text-accent focus:bg-surface-hover focus:text-accent"
              }`}
            >
              {item.icon ? (
                <span className="shrink-0 opacity-70 group-hover:opacity-100" aria-hidden="true">
                  {item.icon}
                </span>
              ) : null}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body
  );
}
