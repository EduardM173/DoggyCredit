import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { ApplicantRecords } from "./public.js";
import { ApplicantRecordsService } from "./applicant-records.service.js";
@Module({
  imports: [PrismaModule],
  providers: [{ provide: ApplicantRecords, useClass: ApplicantRecordsService }],
  exports: [ApplicantRecords],
})
export class ClientsModule {}
