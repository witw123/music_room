/**
 * Type declarations for @sansenjian/qq-music-api/services.
 *
 * The package ships its own types behind the `exports` map, but the server
 * compiles with `moduleResolution: "Node"`, which ignores that map — hence
 * this ambient declaration. Signatures mirror the SDK's `ApiFunction`
 * (`(options) => Promise<ApiResponse>`); response bodies are provider JSON
 * that the client validates at runtime, so they stay `unknown` here instead
 * of the `any` this file used to leak.
 */
declare module "@sansenjian/qq-music-api/services" {
  /** Envelope every SDK service resolves to. */
  export interface QqMusicApiResponse {
    status?: unknown;
    body?: unknown;
  }

  /** Per-request transport options (currently only cookie headers). */
  export interface QqMusicRequestOption {
    headers?: Record<string, string>;
  }

  export function getQQLoginQr(options?: Record<string, unknown>): Promise<QqMusicApiResponse>;
  export function checkQQLoginQr(options: {
    params: { qrsig?: string; ptqrtoken?: string | number };
  }): Promise<QqMusicApiResponse>;
  export function getSearchByKey(options: {
    params: Record<string, unknown>;
    option?: QqMusicRequestOption;
  }): Promise<QqMusicApiResponse>;
  export function getSmartbox(options: {
    params: { key: string };
  }): Promise<QqMusicApiResponse>;
  export function getHotKey(options?: Record<string, unknown>): Promise<QqMusicApiResponse>;
  export function getLyric(options: {
    params: Record<string, unknown>;
    option?: QqMusicRequestOption;
  }): Promise<QqMusicApiResponse>;
  export function getMusicPlay(options: {
    params: { songmid: string; quality: string; resType: string };
    option?: QqMusicRequestOption;
  }): Promise<QqMusicApiResponse>;
  export function getUserDetail(options: {
    uin: string;
    cookie: string;
  }): Promise<QqMusicApiResponse>;
  export function getUserCollectedSongLists(options: {
    uin: string;
    page: number;
    limit: number;
    cookie: string;
  }): Promise<QqMusicApiResponse>;
  export function getUserCollectedAlbums(options: {
    uin: string;
    page: number;
    limit: number;
    cookie: string;
  }): Promise<QqMusicApiResponse>;
  export function getUserFollowSingers(options: {
    uin: string;
    page: number;
    limit: number;
    cookie: string;
  }): Promise<QqMusicApiResponse>;
  export function getRelatedPlaylists(options: {
    params: { songid: string };
    option?: QqMusicRequestOption;
  }): Promise<QqMusicApiResponse>;
  export function getUserPlaylists(options: {
    uin: string;
    limit: number;
    offset: number;
    cookie: string;
  }): Promise<QqMusicApiResponse>;
  export function songListDetail(options: {
    params: { disstid: string };
    option?: QqMusicRequestOption;
  }): Promise<QqMusicApiResponse>;
  export function getAlbumInfo(options: {
    params: { albummid: string };
    option?: QqMusicRequestOption;
  }): Promise<QqMusicApiResponse>;
  export function getAlbumSongs(options: {
    params: { albummid: string };
    option?: QqMusicRequestOption;
  }): Promise<QqMusicApiResponse>;
}
