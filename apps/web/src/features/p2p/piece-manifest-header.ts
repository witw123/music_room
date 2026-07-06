export type CachedPieceManifestHeader = {
  totalChunks: number;
  chunkSize: number;
  mimeType: string;
  pieceHashes?: string[];
};
