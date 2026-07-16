declare module "@meting/core" {
  type MetingResult = string;

  class Meting {
    constructor(server?: string);
    format(enabled?: boolean): this;
    search(keyword: string, options?: { page?: number; limit?: number; type?: number }): Promise<MetingResult>;
    song(id: string): Promise<MetingResult>;
    url(id: string, bitrate?: number): Promise<MetingResult>;
    pic(id: string, size?: number): Promise<MetingResult>;
  }

  export default Meting;
}
