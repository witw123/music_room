import type { ReactNode } from "react";
import { AppRouteShell } from "@/components/AppRouteShell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppRouteShell>{children}</AppRouteShell>;
}
