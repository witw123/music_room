import { MetingPlatformApiClient } from "./meting-platform.client";

describe("MetingPlatformApiClient", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses QQ Music search and vkey endpoints", async () => {
    const client = new MetingPlatformApiClient();
    const fetchMock = jest.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          song: {
            list: [{ songmid: "003abc", songname: "歌曲" }]
          }
        }
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        req_1: {
          data: {
            sip: ["https://sjy6.stream.qqmusic.qq.com/"],
            midurlinfo: [{ purl: "M500003abc003abc.mp3?guid=10000" }]
          }
        }
      }), { status: 200 }));

    await expect(client.searchTracks("qqmusic", {
      keywords: "歌曲",
      limit: 20,
      offset: 0
    })).resolves.toEqual([{ songmid: "003abc", songname: "歌曲" }]);
    await expect(client.getAudioUrl("qqmusic", "003abc", "standard"))
      .resolves.toMatchObject({
        url: "https://sjy6.stream.qqmusic.qq.com/M500003abc003abc.mp3?guid=10000"
      });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });

  it("resolves Kugou playback from the public playInfo endpoint", async () => {
    const client = new MetingPlatformApiClient();
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        hash: "ABC",
        url: "https://sharefs.kugou.com/song.mp3",
        fileSize: 100,
        bitRate: 128
      }), { status: 200 })
    );

    await expect(client.getAudioUrl("kugou", "ABC", "high"))
      .resolves.toEqual({
        url: "https://sharefs.kugou.com/song.mp3",
        size: 100,
        br: 128
      });
  });

  it("signs Qianqian requests and maps the tracklink URL", async () => {
    const client = new MetingPlatformApiClient();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        data: { path: "https://musicdata.baidu.com/song.mp3", rate: 128 }
      }), { status: 200 })
    );

    await expect(client.getAudioUrl("taihe", "T123", "standard"))
      .resolves.toMatchObject({ url: "https://musicdata.baidu.com/song.mp3" });
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("TSID=T123");
    expect(requestUrl).toMatch(/&sign=[a-f0-9]{32}/);
  });

  it("carries Migu content id into the audio resolver", async () => {
    const client = new MetingPlatformApiClient();
    const fetchMock = jest.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        copyrightId: "69078806413",
        contentId: "600929000003357675",
        songName: "小小明星",
        singerList: [{ name: "歌手" }]
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { url: "https://freetyst.nf.migu.cn/song.mp3" }
      }), { status: 200 }));

    const records = await client.searchTracks("migu", {
      keywords: "小小明星",
      limit: 20,
      offset: 0
    });
    expect(records).toEqual([expect.objectContaining({
      _providerTrackId: "69078806413__600929000003357675"
    })]);
    await expect(client.getTrack("migu", "69078806413__600929000003357675"))
      .resolves.toEqual([expect.objectContaining({ copyrightId: "69078806413" })]);
    await expect(client.getAudioUrl(
      "migu",
      "69078806413__600929000003357675",
      "standard"
    )).resolves.toMatchObject({ url: "https://freetyst.nf.migu.cn/song.mp3" });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("contentId=600929000003357675");
  });
});
