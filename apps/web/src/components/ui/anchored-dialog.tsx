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
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      const margin = 12;
      const gap = 10;
      const fitsBelow = anchor.bottom + gap + dialogRect.height <= viewportBottom - margin;
      const fitsAbove = anchor.top - gap - dialogRect.height >= viewportTop + margin;
      const top = fitsBelow || !fitsAbove
        ? Math.min(anchor.bottom + gap, viewportBottom - margin - dialogRect.height)
        : anchor.top - gap - dialogRect.height;
      const left = Math.min(
        Math.max(viewportLeft + margin, anchor.right - dialogRect.width),
        Math.max(viewportLeft + margin, viewportRight - dialogRect.width - margin)
      );

      setPosition({
        top: Math.max(viewportTop + margin, top),
        left
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePosition);
    const dialog = dialogRef.current;
    if (dialog) resizeObserver?.observe(dialog);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
      resizeObserver?.disconnect();
    };
  }, [anchor]);

  if (!portalRoot) return null;

  return createPortal(
    <div
      className="light-overlay-scrim fixed inset-0 z-[80] overflow-y-auto bg-black/75 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-sm"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        aria-labelledby={ariaLabelledBy}
        className={`light-dialog-surface fixed z-[81] max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] w-[min(28rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-[#151a21] p-5 text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.72)] sm:p-6 ${className ?? ""}`}
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
