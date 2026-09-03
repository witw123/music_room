import { RoomsHomePage } from "@/components/room-home";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AppEntryPage() {
  return <RoomsHomePage showSidebar={false} />;
}
