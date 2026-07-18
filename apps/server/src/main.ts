import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { validateRuntimeConfig } from "./common/config/runtime-config";
import { getCorsOrigins, getRequestOrigin, isAllowedOrigin } from "./common/cors/get-cors-origins";
import { ApiExceptionFilter } from "./common/errors/api-exception.filter";
import { readUserSessionCookie } from "./modules/auth/auth.cookies";

async function bootstrap() {
  validateRuntimeConfig();
  const app = await NestFactory.create(AppModule);
  const trustProxy = resolveTrustProxy();
  const corsOrigins = getCorsOrigins();
  if (trustProxy !== false) {
    const expressApp = app.getHttpAdapter().getInstance() as {
      set?: (setting: string, value: unknown) => void;
    };
    expressApp.set?.("trust proxy", trustProxy);
  }
  app.use((request: Request, _response: Response, next: NextFunction) => {
    if (!request.headers["x-session-token"]) {
      const token = readUserSessionCookie(request.headers.cookie);
      if (token) {
        request.headers["x-session-token"] = token;
      }
    }
    next();
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    const hasUserCookie = !!readUserSessionCookie(request.headers.cookie);
    if (
      process.env.NODE_ENV === "production" &&
      isMutation &&
      hasUserCookie &&
      !isAllowedOrigin(request.headers.origin, getRequestOrigin(request), corsOrigins)
    ) {
      response.status(403).json({
        code: "UNAUTHORIZED",
        message: "Origin validation failed."
      });
      return;
    }
    next();
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: corsOrigins,
    credentials: true
  });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  Logger.log(`Music Room server listening on port ${port}`);
}

bootstrap();

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
