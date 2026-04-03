export function hasHostMediaStreamTrack(stream: MediaStream | null | undefined) {
  return !!stream && stream.getAudioTracks().length > 0;
}
