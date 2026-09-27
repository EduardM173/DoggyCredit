import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "./prisma.service.js";

@Injectable()
export class DatabaseUnitOfWork {
  private readonly context = new AsyncLocalStorage<Prisma.TransactionClient>();
  constructor(private readonly prisma: PrismaService) {}

  get client() {
    return this.context.getStore() ?? this.prisma;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return work();
    return this.prisma.$transaction((tx) => this.context.run(tx, work));
  }
}
