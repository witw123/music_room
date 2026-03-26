import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Music Room",
  description: "P2P music room for shared listening."
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

