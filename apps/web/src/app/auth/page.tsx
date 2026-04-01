import { Suspense } from "react";
import { AppOnlyNoticePage } from "@/components/AppOnlyNoticePage";
import { AuthPage } from "@/components/AuthPage";
import { getClientPlatformFromRequest } from "@/lib/client-shell-server";

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const clientPlatform = await getClientPlatformFromRequest(searchParams);

  if (!clientPlatform) {
    return (
      <AppOnlyNoticePage
        title="登录与注册仅在客户端中开放"
        description="网页端不再提供账号登录和房间功能。请下载桌面端或移动端客户端后继续使用 Music Room。"
      />
    );
  }

  return (
    <Suspense fallback={null}>
      <AuthPage />
    </Suspense>
  );
}
