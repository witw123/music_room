import React, { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function RoomDialog({
  title,
  description,
  onClose,
  children
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" ? document.body : null
  );

  useEffect(() => {
    if (!portalRoot && typeof document !== "undefined") {
      setPortalRoot(document.body);
    }
  }, [portalRoot]);

  if (!portalRoot) return null;

  return createPortal(
    <div
      className="light-modal-scrim z-[var(--z-modal)] overscroll-contain"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        aria-modal="true"
        className="light-dialog-surface hide-scrollbar relative my-auto max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-surface-border bg-surface p-5 shadow-2xl sm:p-6"
        role="dialog"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{title}</h2>
            <p className="mt-1.5 text-sm leading-6 text-foreground-muted">{description}</p>
          </div>
          <button
            aria-label="关闭"
            className="rounded-lg px-2 py-1 text-xl leading-none text-foreground-muted hover:bg-white/10 hover:text-foreground cursor-pointer"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    portalRoot
  );
}
