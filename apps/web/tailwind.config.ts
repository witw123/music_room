import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111111",
        sand: "#efe6d3",
        ember: "#cd4c2f",
        pine: "#1f4f46"
      }
    }
  },
  plugins: []
};

export default config;

