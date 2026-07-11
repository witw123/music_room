"use client";

import { useEffect, useRef } from "react";
import { Button } from "./button";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending = false,
  destructive = false,
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open, pending]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm" role="presentation" onMouseDown={() => !pending && onCancel()}>
      <div
        aria-describedby="confirm-dialog-description"
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="w-full max-w-md rounded-lg border border-white/10 bg-surface p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="alertdialog"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-foreground">{title}</h2>
        <p id="confirm-dialog-description" className="mt-2 text-sm leading-6 text-foreground-muted">{description}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button ref={cancelButtonRef} disabled={pending} onClick={onCancel} type="button" variant="ghost">取消</Button>
          <Button
            className={destructive ? "bg-red-600 text-white hover:bg-red-500" : ""}
            disabled={pending}
            onClick={onConfirm}
            type="button"
          >
            {pending ? "正在处理…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
