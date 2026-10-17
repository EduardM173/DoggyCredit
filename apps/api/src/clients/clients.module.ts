import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { IdentityTenantsModule } from "../identity-tenants/identity-tenants.module.js";
import { ClientsService } from "./clients.service.js";
import { ClientsController } from "./clients.controller.js";

@Module({
  imports: [PrismaModule, IdentityTenantsModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
