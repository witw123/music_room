import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { validateRuntimeConfig } from "./common/config/runtime-config";
import { getCorsOrigins } from "./common/cors/get-cors-origins";
import { ApiExceptionFilter } from "./common/errors/api-exception.filter";

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
  app.enableCors({
    origin: getCorsOrigins(),
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
