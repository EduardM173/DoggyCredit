import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateClientDto } from "./dto/create-client.dto.js";

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.client.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  create(tenantId: string, input: CreateClientDto) {
    return this.prisma.client.create({
      data: {
        ...input,
        tenantId,
        email: input.email?.toLowerCase(),
      },
    });
  }
}
