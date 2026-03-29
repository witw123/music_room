import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "音乐房间",
  description: "P2P 音乐房间，共享聆听体验。"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

