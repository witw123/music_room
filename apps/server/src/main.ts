import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { validateRuntimeConfig } from "./common/config/runtime-config";
import { getCorsOrigins } from "./common/cors/get-cors-origins";
import { ApiExceptionFilter } from "./common/errors/api-exception.filter";
import { hasValidCsrfPair } from "./common/auth/session-cookie";
import { createApiErrorResponse, errorCodes } from "@music-room/shared";

async function bootstrap() {
  validateRuntimeConfig();
  const app = await NestFactory.create(AppModule);
  const trustProxy = resolveTrustProxy();
  if (trustProxy !== false) {
    const expressApp = app.getHttpAdapter().getInstance() as {
      set?: (setting: string, value: unknown) => void;
    };
    expressApp.set?.("trust proxy", trustProxy);
  }
  app.useGlobalFilters(new ApiExceptionFilter());
  app.use((request: {
    method?: string;
    originalUrl?: string;
    headers?: Record<string, string | string[] | undefined>;
  }, response: { status(code: number): typeof response; json(body: unknown): void }, next: () => void) => {
    const legacyToken = readHeader(request.headers, "x-session-token");
    if (legacyToken) {
      response.status(426).json(
        createApiErrorResponse(
          errorCodes.clientUpdateRequired,
          "This client version is no longer supported. Please update and sign in again."
        )
      );
      return;
    }

    const method = request.method?.toUpperCase() ?? "GET";
    const isWrite = !["GET", "HEAD", "OPTIONS"].includes(method);
    if (isWrite && request.originalUrl?.split("?")[0] !== "/v1/auth/csrf") {
      const cookie = readHeader(request.headers, "cookie");
      const csrfToken = readHeader(request.headers, "x-csrf-token");
      if (!hasValidCsrfPair(cookie, csrfToken)) {
        response.status(403).json(
          createApiErrorResponse(errorCodes.csrfInvalid, "Invalid CSRF token.")
        );
        return;
      }
    }
    next();
  });
  app.enableCors({
    origin: getCorsOrigins(),
    credentials: true
  });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  Logger.log(`Music Room server listening on port ${port}`);
}

bootstrap();

function readHeader(headers: Record<string, string | string[] | undefined> | undefined, name: string) {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function resolveTrustProxy() {
  const configured = process.env.TRUST_PROXY?.trim();
  if (configured) {
    if (configured === "true") {
      return true;
    }
    if (configured === "false") {
      return false;
    }
    const numeric = Number(configured);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : configured;
  }

  return process.env.NODE_ENV === "production" ? "loopback" : false;
}
