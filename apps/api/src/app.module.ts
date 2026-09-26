import { Module } from "@nestjs/common";
import { ClientsModule } from "./clients/clients.module.js";
import { HealthController } from "./health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";

@Module({
  imports: [PrismaModule, ClientsModule],
  controllers: [HealthController],
})
export class AppModule {}
