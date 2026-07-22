"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type AnchoredDialogAnchor = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

export function getAnchoredDialogAnchor(element: Element): AnchoredDialogAnchor {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height
  };
}

export function AnchoredDialog({
  anchor,
  ariaLabelledBy,
  children,
  className,
  onClose
}: {
  anchor: AnchoredDialogAnchor;
  ariaLabelledBy: string;
  children: ReactNode;
  className?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState(() => getFallbackPosition(anchor));

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useLayoutEffect(() => {
    const updatePosition = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      const dialogRect = dialog.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const margin = 12;
      const gap = 10;
      const fitsBelow = anchor.bottom + gap + dialogRect.height <= viewportHeight - margin;
      const fitsAbove = anchor.top - gap - dialogRect.height >= margin;
      const top = fitsBelow || !fitsAbove
        ? Math.min(anchor.bottom + gap, viewportHeight - margin - dialogRect.height)
        : anchor.top - gap - dialogRect.height;
      const left = Math.min(
        Math.max(margin, anchor.right - dialogRect.width),
        Math.max(margin, viewportWidth - dialogRect.width - margin)
      );

      setPosition({
        top: Math.max(margin, top),
        left
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("resize", updatePosition);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePosition);
    const dialog = dialogRef.current;
    if (dialog) resizeObserver?.observe(dialog);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      resizeObserver?.disconnect();
    };
  }, [anchor]);

  if (!portalRoot) return null;

  return createPortal(
    <div
      className="light-overlay-scrim fixed inset-0 z-[80] overflow-hidden bg-black/75 px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] backdrop-blur-sm"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        aria-labelledby={ariaLabelledBy}
        className={`light-dialog-surface fixed z-[81] max-h-[calc(100dvh-1.5rem)] w-[min(28rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-white/15 bg-[#151a21] p-5 text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.72)] sm:p-6 ${className ?? ""}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        ref={dialogRef}
        style={{ left: position.left, top: position.top }}
      >
        {children}
      </div>
    </div>,
    portalRoot
  );
}

function getFallbackPosition(anchor: AnchoredDialogAnchor) {
  return {
    top: Math.max(12, anchor.bottom + 10),
    left: Math.max(12, anchor.right - 448)
  };
}
