"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  formatFileSize,
  getPlatformDisplayName,
  openExternalUrl,
  type UpdateCheckResult
} from "@/features/update/update-checker";

interface UpdatePromptDialogProps {
  open: boolean;
  result: UpdateCheckResult | null;
  onDismiss: () => void;
}

export function UpdatePromptDialog({
  open,
  result,
  onDismiss
}: UpdatePromptDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss, open]);

  if (!open || !result || !result.hasUpdate) return null;
  if (typeof document === "undefined") return null;

  const downloadTarget = result.matchedAsset;
  const platformName = getPlatformDisplayName(result.platform, result.runtime);

  const handleDownload = () => {
    if (downloadTarget) {
      void openExternalUrl(downloadTarget.browser_download_url);
    } else {
      void openExternalUrl(result.release.html_url);
    }
    onDismiss();
  };

  return createPortal(
    <div
      className="light-modal-scrim z-[var(--z-modal)]"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      role="presentation"
    >
      <div
        aria-describedby="update-dialog-description"
        aria-labelledby="update-dialog-title"
        aria-modal="true"
        className="light-dialog-surface max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-lg border border-surface-border bg-surface p-5 shadow-2xl"
        role="dialog"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-accent" />
            <h2 id="update-dialog-title" className="text-base font-semibold text-foreground">
              发现新版本 v{result.latestVersion}
            </h2>
          </div>
          <span className="rounded bg-surface-hover px-2 py-0.5 text-xs text-foreground-muted">
            {platformName}
          </span>
        </div>

        <p id="update-dialog-description" className="mt-2 text-xs leading-5 text-foreground-muted">
          当前运行版本为 v{result.currentVersion}。检测到 GitHub 远端有新版本发布。
        </p>

        {downloadTarget ? (
          <div className="mt-3.5 rounded border border-surface-border bg-background/50 p-2.5 text-xs">
            <div className="font-mono text-foreground">{downloadTarget.name}</div>
            {downloadTarget.size > 0 ? (
              <div className="mt-1 text-foreground-muted">
                安装包大小: {formatFileSize(downloadTarget.size)}
              </div>
            ) : null}
          </div>
        ) : null}

        {result.release.body ? (
          <div className="mt-3.5 max-h-40 overflow-y-auto rounded border border-surface-border bg-background/30 p-2.5 text-xs text-foreground-muted">
            <div className="mb-1 font-medium text-foreground">更新日志:</div>
            <div className="whitespace-pre-wrap font-sans text-xs leading-5 opacity-90">
              {result.release.body}
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onDismiss} size="sm" type="button" variant="ghost">
            稍后提醒
          </Button>
          <Button onClick={handleDownload} size="sm" type="button" variant="default">
            {downloadTarget ? "立即下载" : "前往下载"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
