declare module "@sansenjian/qq-music-api/services" {
  export const checkQQLoginQr: (options: any) => Promise<any>;
  export const getMusicPlay: (options: any) => Promise<any>;
  export const getQQLoginQr: (options: any) => Promise<any>;
  export const getSearchByKey: (options: any) => Promise<any>;
  export const getLyric: (options: any) => Promise<any>;
  export const getUserPlaylists: (options: any) => Promise<any>;
  export const songListDetail: (options: any) => Promise<any>;
  export const getAlbumInfo: (options: any) => Promise<any>;
  export const getAlbumSongs: (options: any) => Promise<any>;
}
