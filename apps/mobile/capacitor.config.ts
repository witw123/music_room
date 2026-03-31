import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.musicroom.mobile",
  appName: "Music Room",
  webDir: "www",
  server: {
    url: "https://witw.top",
    cleartext: false,
    androidScheme: "https"
  }
};

export default config;
