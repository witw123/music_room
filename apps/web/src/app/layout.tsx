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
    const sidebarCollapsed = !(value && value.layout && value.layout.sidebarCollapsed === false);
    const systemPrefersLight = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches;
    const light = preference === "light" || (preference === "system" && systemPrefersLight);
    const theme = light ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.sidebarCollapsed = String(sidebarCollapsed);
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f5f5f7" : "#09090b");
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
  description: "与好友实时同步收听本地高保真音乐。Music Room 通过房间状态同步和 WebRTC RTP Opus 媒体链路，提供浏览器优先的协作听歌体验。",
  keywords: ["Music Room", "音乐房", "一起听歌", "共享队列", "高保真音乐", "实时协作"]
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
