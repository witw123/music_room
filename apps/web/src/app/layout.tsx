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
  description: "打破空间距离，与好友实时同步收听本地高保真无损音乐库。支持极低延迟的 P2P 流媒体分发，为您带来无缝的跨设备协作收听体验。",
  keywords: ["Music Room", "音乐房", "一起听歌", "共享队列", "无损音乐", "实时协作"]
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
