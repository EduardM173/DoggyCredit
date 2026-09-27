import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { AuditWriter } from "./public.js";
import { AuditService } from "./audit.service.js";

@Module({
  imports: [PrismaModule],
  providers: [{ provide: AuditWriter, useClass: AuditService }],
  exports: [AuditWriter],
})
export class AuditModule {}
