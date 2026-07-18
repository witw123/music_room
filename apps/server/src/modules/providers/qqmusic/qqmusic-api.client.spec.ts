import { getQQLoginQr } from "@sansenjian/qq-music-api/services";
import { QqMusicApiClient } from "./qqmusic-api.client";

jest.mock("@sansenjian/qq-music-api/services", () => ({
  checkQQLoginQr: jest.fn(),
  getMusicPlay: jest.fn(),
  getQQLoginQr: jest.fn(),
  getSearchByKey: jest.fn()
}));

const mockedGetQQLoginQr = getQQLoginQr as jest.MockedFunction<typeof getQQLoginQr>;

describe("QqMusicApiClient", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("reads the flat QR payload returned by qq-music-api", async () => {
    mockedGetQQLoginQr.mockResolvedValue({
      status: 200,
      body: {
        img: "data:image/png;base64,qr",
        qrsig: "qr-signature",
        ptqrtoken: "qr-token"
      }
    } as never);

    await expect(new QqMusicApiClient().createQrCode()).resolves.toEqual({
      qrimg: "data:image/png;base64,qr",
      qrsig: "qr-signature",
      ptqrtoken: "qr-token"
    });
  });

  it("accepts the nested QR payload used by older provider versions", async () => {
    mockedGetQQLoginQr.mockResolvedValue({
      status: 200,
      body: {
        response: {
          img: "data:image/png;base64:qr",
          qrsig: "qr-signature",
          ptqrtoken: "qr-token"
        }
      }
    } as never);

    await expect(new QqMusicApiClient().createQrCode()).resolves.toEqual({
      qrimg: "data:image/png;base64:qr",
      qrsig: "qr-signature",
      ptqrtoken: "qr-token"
    });
  });
});
