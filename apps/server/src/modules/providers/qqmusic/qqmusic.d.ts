declare module "@sansenjian/qq-music-api/services" {
  export const checkQQLoginQr: (options: any) => Promise<any>;
  export const getMusicPlay: (options: any) => Promise<any>;
  export const getQQLoginQr: (options: any) => Promise<any>;
  export const getSearchByKey: (options: any) => Promise<any>;
  export const getSmartbox: (options: any) => Promise<any>;
  export const getHotKey: (options: any) => Promise<any>;
  export const getLyric: (options: any) => Promise<any>;
  export const getUserPlaylists: (options: any) => Promise<any>;
  export const getDigitalAlbumLists: (options: any) => Promise<any>;
  export const getRecommendBanner: (options: any) => Promise<any>;
  export const getTopLists: (options: any) => Promise<any>;
  export const songListCategories: (options: any) => Promise<any>;
  export const songLists: (options: any) => Promise<any>;
  export const songListDetail: (options: any) => Promise<any>;
  export const getAlbumInfo: (options: any) => Promise<any>;
  export const getAlbumSongs: (options: any) => Promise<any>;
  export const getRelatedPlaylists: (options: any) => Promise<any>;
  export const getUserCollectedAlbums: (options: any) => Promise<any>;
  export const getUserCollectedSongLists: (options: any) => Promise<any>;
  export const getUserFollowSingers: (options: any) => Promise<any>;
}
