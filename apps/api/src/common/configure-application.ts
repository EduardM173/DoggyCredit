import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { HttpExceptionFilter } from "./filters/http-exception.filter.js";

export function configureApplication(app: INestApplication) {
  const config = app.get(ConfigService);

  app.setGlobalPrefix("api");
  app.use(helmet());
  app.enableCors({
    origin: config.getOrThrow<string>("WEB_ORIGIN"),
    credentials: true,
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
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);
}
