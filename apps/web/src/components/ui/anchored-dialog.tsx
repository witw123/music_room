"use client";

import type { ReactNode } from "react";

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
  // Keep the anchor in the API for callers that already capture the triggering row.
  // Dialogs are intentionally centered so their position does not depend on scroll depth.
  void anchor;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 px-4 py-6 backdrop-blur-sm"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        aria-labelledby={ariaLabelledBy}
        className={`relative z-[51] max-h-[calc(100dvh-3rem)] w-full overflow-y-auto rounded-2xl border border-white/15 bg-[#151a21] p-5 text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.72)] sm:p-6 ${className ?? ""}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}
