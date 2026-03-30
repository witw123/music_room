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
  themeColor: "#F8FAFC"
};

export const metadata: Metadata = {
  title: "音乐房间",
  description: "本地上传、实时同听、房间协作的一体化音乐网站。",
  keywords: ["音乐房间", "音乐同听", "P2P", "房间协作", "实时同播"]
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
