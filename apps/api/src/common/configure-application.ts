import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import type { Request, Response, NextFunction } from "express";
import { HttpExceptionFilter } from "./filters/http-exception.filter.js";

export function configureApplication(app: INestApplication) {
  const config = app.get(ConfigService);

  app.setGlobalPrefix("api");
  app.use(helmet());
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (
      [
        "/api/admin/",
        "/api/institution/",
        "/api/institution-requests",
        "/api/membership-invitations",
        "/api/contracting",
        "/api/mock-payment-provider",
      ].some((prefix) => request.path.startsWith(prefix))
    )
      response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.enableCors({
    origin: [
      ...new Set([
        config.getOrThrow<string>("WEB_ORIGIN"),
        ...(config.get<string>("MOCK_PAYMENT_PUBLIC_URL")
          ? [new URL(config.getOrThrow<string>("MOCK_PAYMENT_PUBLIC_URL")).origin]
          : []),
      ]),
    ],
    credentials: true,
    exposedHeaders: ["Retry-After"],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle("DoggyCredit API")
    .setDescription("Contratos HTTP disponibles en la plataforma DoggyCredit.")
    .setVersion("0.1.0")
    .addCookieAuth("doggycredit_admin")
    .addCookieAuth("dc-institution-session")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);
}
