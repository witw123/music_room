import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import { PersistentRoomRuntime } from "@/components/PersistentRoomRuntime";
import "./globals.css";

const themeInitScript = `(() => {
  try {
    const raw = localStorage.getItem("music-room-settings-v1");
    const value = raw ? JSON.parse(raw) : null;
    const preference = value && (value.theme === "light" || value.theme === "system" || value.theme === "dark") ? value.theme : "dark";
    const systemPrefersLight = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches;
    const light = preference === "light" || (preference === "system" && systemPrefersLight);
    const theme = light ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f5f7fb" : "#09090b");
  } catch {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#09090b");
  }
})();`;

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
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">{themeInitScript}</Script>
      </head>
      <body className={plusJakartaSans.variable}>
        <PersistentRoomRuntime>{children}</PersistentRoomRuntime>
      </body>
    </html>
  );
}
