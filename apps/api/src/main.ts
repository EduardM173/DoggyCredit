import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { configureApplication } from "./common/configure-application.js";
import { TenantProvisioningWorker } from "./identity-tenants/public.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApplication(app);
  await app.listen(Number(process.env.API_PORT ?? 3000));
  app.enableShutdownHooks();
  app.get(TenantProvisioningWorker).start();
}

void bootstrap();
