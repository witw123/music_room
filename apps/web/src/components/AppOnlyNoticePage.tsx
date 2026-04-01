import Link from "next/link";
import { githubReleasesUrl } from "@/lib/client-shell";

type AppOnlyNoticePageProps = {
  title?: string;
  description?: string;
};

export function AppOnlyNoticePage({
  title = "该页面仅在软件客户端中可用",
  description = "网页版现在只保留项目介绍与下载入口。请下载客户端后登录、创建房间、加入房间并使用同步播放功能。"
}: AppOnlyNoticePageProps) {
  return (
    <main className="min-h-screen bg-[#000000] text-white">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-24 text-center">
        <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.3em] text-accent">
          Client Only
        </p>
        <h1 className="max-w-4xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          {title}
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-8 text-white/55 sm:text-lg">
          {description}
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
          <Link
            href="/"
            className="inline-flex min-w-[180px] items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            返回介绍页
          </Link>
          <Link
            href={githubReleasesUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-[220px] items-center justify-center rounded-2xl bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            前往下载客户端
          </Link>
        </div>
      </section>
    </main>
  );
}
