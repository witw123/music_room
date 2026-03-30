import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0c0c10",
        sand: "#eee8d5",
        accent: "#8b5cf6",
        "accent-hover": "#a78bfa",
        pine: "#22c55e"
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
        display: ["Outfit", "Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"]
      }
    }
  },
  plugins: []
};

export default config;

