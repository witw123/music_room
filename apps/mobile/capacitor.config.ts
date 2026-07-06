import type { CapacitorConfig } from "@capacitor/cli";
import mobilePackage from "./package.json";

const publicOrigin = (process.env.MUSIC_ROOM_PUBLIC_ORIGIN || "https://example.com").replace(
  /\/$/,
  ""
);

const config: CapacitorConfig = {
  appId: "com.musicroom.mobile",
  appName: "Music Room",
  webDir: "www",
  server: {
    url: `${publicOrigin}/app?client=mobile&version=${mobilePackage.version}`,
    cleartext: false,
    androidScheme: "https"
  }
};

export default config;
