import { MetingApiClient } from "./meting-api.client";

describe("MetingApiClient", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("falls back when Kuwo returns an empty formatted record", async () => {
    const client = new MetingApiClient();
    const create = jest.spyOn(
      client as unknown as { create: () => Promise<unknown> },
      "create"
    );
    create.mockResolvedValue({
      search: jest.fn().mockResolvedValue('[{"artist":[],"album":"","source":"kuwo"}]')
    });
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        "{'abslist':[{'MUSICRID':'MUSIC_123','SONGNAME':'晴天&nbsp;','ARTIST':'周杰伦','ALBUM':'叶惠美','DURATION':'240','PAY':'0'}]}",
        { status: 200 }
      )
    );

    await expect(client.searchTracks("kuwo", {
      keywords: "晴天",
      limit: 20,
      offset: 0
    })).resolves.toEqual([{
      id: "123",
      name: "晴天",
      artist: ["周杰伦"],
      album: "叶惠美",
      interval: 240,
      access: "free"
    }]);
  });

  it("falls back to Kuwo's legacy public MP3 resolver", async () => {
    const client = new MetingApiClient();
    const create = jest.spyOn(
      client as unknown as { create: () => Promise<unknown> },
      "create"
    );
    create.mockResolvedValue({
      url: jest.fn().mockResolvedValue('{"url":"","size":0,"br":-1}')
    });
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("https://audio.kuwo.cn/song.mp3", { status: 200 })
    );

    await expect(client.getAudioUrl("kuwo", "123", "standard")).resolves.toEqual({
      url: "https://audio.kuwo.cn/song.mp3",
      size: 0,
      br: 128
    });
  });
});
