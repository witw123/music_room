import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

const defaultCorsOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];

function getCorsOrigins() {
  const configuredOrigins = process.env.CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configuredOrigins?.length ? configuredOrigins : defaultCorsOrigins;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: getCorsOrigins(),
    credentials: true
  });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  Logger.log(`Music Room server listening on port ${port}`);
}

bootstrap();
