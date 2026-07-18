import { checkQQLoginQr, getQQLoginQr } from "@sansenjian/qq-music-api/services";
import { QqMusicApiClient } from "./qqmusic-api.client";

jest.mock("@sansenjian/qq-music-api/services", () => ({
  checkQQLoginQr: jest.fn(),
  getMusicPlay: jest.fn(),
  getQQLoginQr: jest.fn(),
  getSearchByKey: jest.fn()
}));

const mockedGetQQLoginQr = getQQLoginQr as jest.MockedFunction<typeof getQQLoginQr>;
const mockedCheckQQLoginQr = checkQQLoginQr as jest.MockedFunction<typeof checkQQLoginQr>;

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

  it("keeps polling when the flat QR status says the code is not scanned", async () => {
    mockedCheckQQLoginQr.mockResolvedValue({
      status: 200,
      body: { isOk: false, refresh: false, message: "未扫描二维码" }
    } as never);

    await expect(new QqMusicApiClient().checkQrCode({ qrsig: "qr-signature", ptqrtoken: "qr-token" })).resolves.toEqual({
      status: "pending",
      session: null,
      message: "未扫描二维码"
    });
    expect(mockedCheckQQLoginQr).toHaveBeenCalledWith({ params: { qrsig: "qr-signature", ptqrtoken: "qr-token" } });
  });

  it("returns a session when the flat QR status reports a completed login", async () => {
    mockedCheckQQLoginQr.mockResolvedValue({
      status: 200,
      body: {
        isOk: true,
        refresh: false,
        message: "登录成功",
        session: {
          uin: "123456",
          cookie: "uin=o123456; skey=secret"
        }
      }
    } as never);

    await expect(new QqMusicApiClient().checkQrCode({ qrsig: "qr-signature", ptqrtoken: "qr-token" })).resolves.toEqual({
      status: "connected",
      session: {
        cookie: "uin=o123456; skey=secret",
        userId: "123456",
        nickname: null,
        avatarUrl: null
      }
    });
  });
});
