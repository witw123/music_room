import { AppOnlyNoticePage } from "@/components/AppOnlyNoticePage";
import { RoomsHomePage } from "@/components/RoomsHomePage";
import { getClientPlatformFromRequest } from "@/lib/client-shell-server";

export default async function RoomsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const clientPlatform = await getClientPlatformFromRequest(searchParams);

  if (!clientPlatform) {
    return (
      <AppOnlyNoticePage
        title="房间列表仅在客户端中开放"
        description="浏览器中不再展示房间列表。请在客户端中创建、加入和恢复你的音乐房。"
      />
    );
  }

  return <RoomsHomePage />;
}
