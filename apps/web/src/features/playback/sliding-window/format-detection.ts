export type SlidingWindowFormat = "flac" | "wav" | "mp3" | "unsupported";

export function resolveSlidingWindowFormat(input: {
  mimeType?: string | null;
  codec?: string | null;
  title?: string | null;
}): SlidingWindowFormat {
  const mimeType = normalize(input.mimeType);
  const codec = normalize(input.codec);
  const title = normalize(input.title);
  const signature = `${mimeType} ${codec} ${title}`;

  if (signature.includes("flac") || title.endsWith(".flac")) {
    return "flac";
  }

  if (
    signature.includes("wav") ||
    signature.includes("wave") ||
    title.endsWith(".wav")
  ) {
    return "wav";
  }

  if (
    mimeType === "audio/mpeg" ||
    mimeType === "audio/mp3" ||
    codec === "mp3" ||
    codec === "mpeg" ||
    title.endsWith(".mp3")
  ) {
    return "mp3";
  }

  return "unsupported";
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}
