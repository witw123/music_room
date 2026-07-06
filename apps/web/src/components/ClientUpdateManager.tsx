"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  checkClientUpdate,
  type ClientUpdate,
  type ClientUpdateCheckMode
} from "@/features/update/client-update-service";
import { Button } from "@/components/ui/button";

type ClientUpdateContextValue = {
  checking: boolean;
  statusMessage: string;
  checkForUpdates: (mode?: ClientUpdateCheckMode) => Promise<void>;
};

const ClientUpdateContext = createContext<ClientUpdateContextValue | null>(null);

export function useClientUpdateControls() {
  return useContext(ClientUpdateContext);
}

export function ClientUpdateManager({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [update, setUpdate] = useState<ClientUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const checkingRef = useRef(false);

  const checkForUpdates = useCallback(async (mode: ClientUpdateCheckMode = "manual") => {
    if (checkingRef.current) {
      return;
    }

    checkingRef.current = true;
    setChecking(true);
    if (mode === "manual") {
      setStatusMessage("正在检查更新...");
    }

    try {
      const result = await checkClientUpdate(mode);
      if (result.status === "available") {
        setUpdate(result.update);
        setStatusMessage("");
        return;
      }

      if (mode === "manual") {
        setStatusMessage(
          result.status === "failed" ? result.message : "当前已经是最新版本。"
        );
      }
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkForUpdates("startup");
    }, 3500);

    return () => window.clearTimeout(timer);
  }, [checkForUpdates]);

  const contextValue = useMemo(
    () => ({
      checking,
      statusMessage,
      checkForUpdates
    }),
    [checking, statusMessage, checkForUpdates]
  );

  async function handlePrimaryAction() {
    if (!update) {
      return;
    }

    if (update.platform === "mobile") {
      await update.openDownload();
      setUpdate(null);
      return;
    }

    setInstalling(true);
    try {
      await update.install();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "安装更新失败。");
      setInstalling(false);
    }
  }

  return (
    <ClientUpdateContext.Provider value={contextValue}>
      {children}
      {update ? (
        <div className="fixed inset-x-4 bottom-5 z-[80] mx-auto max-w-md rounded-2xl border border-white/10 bg-[#090909]/95 p-4 text-white shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Update Available
              </p>
              <h2 className="mt-1 text-base font-bold">
                发现新版本 {update.version}
              </h2>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-white/55">
                {update.notes || "建议更新到最新版本，以获得最新修复和稳定性改进。"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={handlePrimaryAction}
                disabled={installing}
                type="button"
              >
                {installing
                  ? "正在安装..."
                  : update.platform === "desktop"
                    ? "下载并安装"
                    : "前往下载 APK"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setUpdate(null)}
                disabled={installing}
                type="button"
              >
                稍后
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </ClientUpdateContext.Provider>
  );
}
