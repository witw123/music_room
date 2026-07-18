jest.mock("node:dns/promises", () => ({
  lookup: jest.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
}));

import { lookup } from "node:dns/promises";
import { fetchProviderUrl, isPrivateAddress } from "./provider-fetch";

const mockedLookup = lookup as jest.MockedFunction<typeof lookup>;

describe("provider URL safeguards", () => {
  it("blocks private IPv4-mapped IPv6 addresses", () => {
    expect(isPrivateAddress("::ffff:172.16.0.1")).toBe(true);
    expect(isPrivateAddress("0:0:0:0:0:ffff:7f00:1")).toBe(true);
    expect(isPrivateAddress("2001:4860:4860::8888")).toBe(false);
  });

  it("rejects redirects that leave HTTPS", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      status: 302,
      headers: new Headers({ location: "http://cdn.example.com/audio.mp3" }),
      body: { cancel: jest.fn().mockResolvedValue(undefined) }
    } as unknown as Response);

    await expect(
      fetchProviderUrl(
        new URL("https://cdn.example.com/audio.mp3"),
        {},
        1_000,
        (hostname) => hostname.endsWith(".example.com")
      )
    ).rejects.toThrow("unsupported URL");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it("keeps benchmark-range DNS aliases blocked unless a provider opts in", async () => {
    mockedLookup.mockResolvedValue([
      { address: "198.18.0.143", family: 4 }
    ] as never);
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "audio/mpeg" }),
      body: { cancel: jest.fn().mockResolvedValue(undefined) }
    } as unknown as Response);

    await expect(
      fetchProviderUrl(
        new URL("https://m10.music.126.net/audio.mp3"),
        {},
        1_000,
        (hostname) => hostname.endsWith(".126.net")
      )
    ).rejects.toThrow("private address");

    await expect(
      fetchProviderUrl(
        new URL("https://m10.music.126.net/audio.mp3"),
        {},
        1_000,
        (hostname) => hostname.endsWith(".126.net"),
        { allowSyntheticDns: true }
      )
    ).resolves.toMatchObject({ status: 200 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });
});
