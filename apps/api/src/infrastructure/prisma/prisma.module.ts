import { Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { DatabaseUnitOfWork } from "./database-unit-of-work.js";

@Module({ providers: [PrismaService, DatabaseUnitOfWork], exports: [PrismaService, DatabaseUnitOfWork] })
export class PrismaModule {}
