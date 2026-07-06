"use client";

import type { ReactNode } from "react";
import { ClientUpdateManager } from "@/components/ClientUpdateManager";

export function Providers({ children }: { children: ReactNode }) {
  return <ClientUpdateManager>{children}</ClientUpdateManager>;
}
