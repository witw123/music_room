import process from "node:process";
import fs from "node:fs";

const rawOrigin = process.env.MUSIC_ROOM_PUBLIC_ORIGIN?.trim() ?? "";
const lifecycle = process.env.npm_lifecycle_event ?? "package";
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageVersion = packageJson.version;

if (!rawOrigin) {
  console.error(
    `[release] MUSIC_ROOM_PUBLIC_ORIGIN is required for ${lifecycle} and cannot be omitted.`
  );
  process.exit(1);
}

let parsedOrigin;
try {
  parsedOrigin = new URL(rawOrigin);
} catch {
  console.error(`[release] MUSIC_ROOM_PUBLIC_ORIGIN is not a valid URL: ${rawOrigin}`);
  process.exit(1);
}

if (parsedOrigin.protocol !== "https:" && parsedOrigin.protocol !== "http:") {
  console.error(
    `[release] MUSIC_ROOM_PUBLIC_ORIGIN must use http or https: ${parsedOrigin.toString()}`
  );
  process.exit(1);
}

if (parsedOrigin.hostname === "example.com") {
  console.error("[release] MUSIC_ROOM_PUBLIC_ORIGIN cannot point to example.com for packaged clients.");
  process.exit(1);
}

if (parsedOrigin.origin !== "https://musicroom.witw.top") {
  console.error(
    `[release] MUSIC_ROOM_PUBLIC_ORIGIN must point to https://musicroom.witw.top for ${packageVersion} official packages. Current: ${parsedOrigin.origin}`
  );
  process.exit(1);
}


console.log(`[release] Using MUSIC_ROOM_PUBLIC_ORIGIN=${parsedOrigin.origin}`);
