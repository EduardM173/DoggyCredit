import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { ClientsService } from "./clients.service.js";

@Module({
  imports: [PrismaModule],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
