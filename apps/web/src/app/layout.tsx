import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans"
});

export const viewport: Viewport = {
  themeColor: "#09090b"
};

export const metadata: Metadata = {
  title: "Music Room",
  description: "一个面向实时协作听歌的音乐房网站，支持房间、共享队列、本地音乐与登录账号体系。",
  keywords: ["Music Room", "音乐房", "一起听歌", "共享队列", "本地音乐", "实时协作"]
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={plusJakartaSans.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
