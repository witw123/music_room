export function hasHostMediaStreamTrack(stream: MediaStream | null | undefined) {
  return !!stream && stream.getAudioTracks().length > 0;
}

export function shouldDeferHostMediaStreamSync(input: {
  stream: MediaStream | null | undefined;
  listenerPeerCount: number;
  playbackStatus: "playing" | "paused" | "idle";
}) {
  return (
    input.playbackStatus === "playing" &&
    input.listenerPeerCount > 0 &&
    !hasHostMediaStreamTrack(input.stream)
  );
}
