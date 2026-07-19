"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

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
  const [position, setPosition] = useState<PopoverPosition>(() => getPopoverPosition(anchor));

  useEffect(() => {
    const updatePosition = () => setPosition(getPopoverPosition(anchor));
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor]);

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px]" onMouseDown={onClose} role="presentation">
      <div
        aria-labelledby={ariaLabelledBy}
        className={`fixed z-[51] overflow-y-auto rounded-2xl border border-surface-border bg-surface p-5 shadow-2xl sm:p-6 ${className ?? ""}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={position}
      >
        {children}
      </div>
    </div>
  );
}

type PopoverPosition = CSSProperties;

function getPopoverPosition(anchor: AnchoredDialogAnchor): PopoverPosition {
  if (typeof window === "undefined") {
    return {
      left: 12,
      top: 12,
      width: "min(22.5rem, calc(100vw - 1.5rem))",
      maxHeight: "72vh"
    };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const edge = 12;
  const width = Math.min(360, Math.max(0, viewportWidth - edge * 2));
  const maxHeight = Math.min(680, Math.max(180, Math.floor(viewportHeight * 0.72)), viewportHeight - edge * 2);
  const left = Math.min(
    Math.max(edge, anchor.right - width),
    Math.max(edge, viewportWidth - width - edge)
  );
  const belowTop = anchor.bottom + 8;
  const aboveTop = anchor.top - maxHeight - 8;
  const hasRoomBelow = belowTop + maxHeight <= viewportHeight - edge;
  const hasRoomAbove = aboveTop >= edge;

  if (!hasRoomBelow && hasRoomAbove) {
    return { left, bottom: viewportHeight - anchor.top + 8, width, maxHeight };
  }

  return {
    left,
    top: Math.min(belowTop, Math.max(edge, viewportHeight - maxHeight - edge)),
    width,
    maxHeight
  };
}
