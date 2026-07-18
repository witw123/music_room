jest.mock("node:dns/promises", () => ({
  lookup: jest.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
}));

import { fetchProviderUrl, isPrivateAddress } from "./provider-fetch";

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
});
