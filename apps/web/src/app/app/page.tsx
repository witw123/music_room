import { AppOnlyNoticePage } from "@/components/AppOnlyNoticePage";
import { RoomsHomePage } from "@/components/RoomsHomePage";
import { getClientPlatformFromRequest } from "@/lib/client-shell-server";

export default async function AppEntryPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const clientPlatform = await getClientPlatformFromRequest(searchParams);

  if (!clientPlatform) {
    return (
      <AppOnlyNoticePage
        title="房间工作台仅在客户端中开放"
        description="网页端现在只保留介绍与下载。创建房间、加入房间和同步播放功能请在客户端中使用。"
      />
    );
  }

  return <RoomsHomePage />;
}
