import { RoomsHomePage } from "@/components/RoomsHomePage";
import { AppRouteShell } from "@/components/AppRouteShell";

export default function RoomsPage() {
  return (
    <AppRouteShell>
      <RoomsHomePage showSidebar={false} />
    </AppRouteShell>
  );
}
