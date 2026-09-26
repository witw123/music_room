import type { Response } from "express";

/**
 * 各 provider 控制器共用的“上游 Web ReadableStream → HTTP 响应”字节搬运器。
 *
 * 职责:桥接 fetch 流与 Node 响应、可选的 maxBytes 限流、客户端断开时取消上游。
 * 状态码与响应头策略由各 controller 自行设置(平台间差异是刻意的),
 * 错误统一走 onError(缺省为销毁响应连接)。
 */
export type HttpResponseLike = Response;

export type UpstreamByteLimit = {
  limit: number;
  message: string;
};

export async function pipeWebStreamToResponse(input: {
  request: { on(event: "close", listener: () => void): unknown };
  response: HttpResponseLike;
  body: ReadableStream<Uint8Array> | null;
  maxBytes?: UpstreamByteLimit;
  onError?: (error: unknown) => void;
}): Promise<void> {
  if (!input.body) {
    input.response.end();
    return;
  }

  const upstreamBody = input.body;
  const { Readable, Transform } = await import("node:stream");

  const handleFailure = (error: unknown) => {
    void upstreamBody.cancel().catch(() => undefined);
    if (input.onError) {
      input.onError(error);
    } else if (!input.response.destroyed) {
      input.response.destroy();
    }
  };

  let pipeline: NodeJS.ReadableStream = Readable.fromWeb(upstreamBody as import("node:stream/web").ReadableStream);
  pipeline.on("error", handleFailure);

  if (input.maxBytes) {
    const maxBytes = input.maxBytes;
    let transferredBytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        transferredBytes += chunk.byteLength;
        if (transferredBytes > maxBytes.limit) {
          callback(new Error(maxBytes.message));
          return;
        }
        callback(null, chunk);
      }
    });
    limiter.on("error", handleFailure);
    pipeline = pipeline.pipe(limiter);
  }

  pipeline.pipe(input.response);
  input.request.on("close", () => {
    if (!input.response.writableEnded) {
      void upstreamBody.cancel().catch(() => undefined);
    }
  });
}
