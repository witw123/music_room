import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import { PersistentRoomRuntime } from "@/components/shell";
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
  themeColor: "#09090b",
  // Cover mode is what makes env(safe-area-inset-*) report real values; the
  // Capacitor shell loads this page as a remote URL, so the shell's own
  // viewport meta never applies. Without it every inset padding in
  // globals.css (bottom navigation, floating player, room bottom inset) is
  // inert and content sits under the status bar / gesture bar.
  viewportFit: "cover"
};

// The Capacitor WebView offers no reachable devtools in release builds, so a
// client-side exception there is an opaque "Application error" page. Capture
// window-level errors, rejections, and console.error into an on-screen overlay
// — active only inside the native shell, invisible in plain browsers.
const shellErrorReporterScript = `(() => {
  try {
    if (!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform())) {
      return;
    }
    const serialize = (value) => {
      if (value instanceof Error) return value.stack || \`\${value.name}: \${value.message}\`;
      if (typeof value === "object" && value !== null) {
        try { return JSON.stringify(value); } catch { return String(value); }
      }
      return String(value);
    };
    const show = (heading, detail) => {
      let box = document.getElementById("shell-error-overlay");
      if (!box) {
        box = document.createElement("pre");
        box.id = "shell-error-overlay";
        box.setAttribute("role", "alert");
        box.style.cssText = "position:fixed;left:0;right:0;bottom:0;max-height:50%;overflow:auto;z-index:2147483647;margin:0;background:#2b0707;color:#ffb4b4;font:11px/1.45 monospace;padding:10px;white-space:pre-wrap;word-break:break-all;border-top:2px solid #ff5252;";
        (document.body || document.documentElement).appendChild(box);
      }
      box.textContent += (box.textContent ? "\\n\\n" : "") + heading + "\\n" + detail;
    };
    window.addEventListener("error", (event) => {
      const error = event.error;
      show(
        "[error]",
        error instanceof Error ? (error.stack || error.message) : \`\${event.message} @ \${event.filename}:\${event.lineno}\`
      );
    });
    window.addEventListener("unhandledrejection", (event) => {
      show("[unhandledrejection]", serialize(event.reason));
    });
    const originalConsoleError = console.error.bind(console);
    console.error = (...args) => {
      try {
        show("[console.error]", args.map(serialize).join(" "));
      } catch {}
      originalConsoleError(...args);
    };
  } catch {}
})();`;

export const metadata: Metadata = {
  title: "Music Room",
  description: "与好友实时同步收听本地高保真音乐。Music Room 通过房间状态同步和 WebRTC RTP Opus 媒体链路，提供浏览器优先的协作听歌体验。",
  keywords: ["Music Room", "音乐房", "一起听歌", "共享队列", "高保真音乐", "实时协作"],
  manifest: "/manifest.webmanifest"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">{themeInitScript}</Script>
        <Script id="shell-error-reporter" strategy="beforeInteractive">{shellErrorReporterScript}</Script>
      </head>
      <body className={plusJakartaSans.variable}>
        <PersistentRoomRuntime>{children}</PersistentRoomRuntime>
      </body>
    </html>
  );
}
