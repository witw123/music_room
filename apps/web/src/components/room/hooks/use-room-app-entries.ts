"use client";

import { buildAppEntryHref, buildWorkspaceAuthHref } from "@/lib/client-shell";
import { getClientPlatformFromBrowser } from "@/lib/client-shell-browser";

type UseRoomAppEntriesInput = {
  initialRoomId: string | null;
};

export function useRoomAppEntries({ initialRoomId }: UseRoomAppEntriesInput) {
  const clientPlatform = getClientPlatformFromBrowser();
  const workspaceEntryHref = buildAppEntryHref(clientPlatform);
  const authEntryHref = buildWorkspaceAuthHref({
    clientPlatform,
    redirectTo: initialRoomId ? `/room/${initialRoomId}` : workspaceEntryHref
  });

  return {
    authEntryHref,
    workspaceEntryHref
  };
}
