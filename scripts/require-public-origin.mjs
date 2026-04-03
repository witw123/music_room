import process from "node:process";

const rawOrigin = process.env.MUSIC_ROOM_PUBLIC_ORIGIN?.trim() ?? "";
const lifecycle = process.env.npm_lifecycle_event ?? "package";

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

console.log(`[release] Using MUSIC_ROOM_PUBLIC_ORIGIN=${parsedOrigin.origin}`);
