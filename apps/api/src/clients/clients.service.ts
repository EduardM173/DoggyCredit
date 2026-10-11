import { Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { Client, ClientType, DocumentType } from "../generated/prisma/client.js";

export interface CreateClientInput {
  type: ClientType;
  documentType: DocumentType;
  documentNumber: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  economicActivity?: string;
}

@Injectable()
export class ClientsService {
  constructor(private readonly db: DatabaseUnitOfWork) {}

  async findByDocument(
    tenantId: string,
    documentType: DocumentType,
    documentNumber: string,
    type?: ClientType,
  ): Promise<Client | null> {
    const normalizedDoc = documentNumber.trim();
    const client = await this.db.client.client.findUnique({
      where: {
        tenantId_documentType_documentNumber: {
          tenantId,
          documentType,
          documentNumber: normalizedDoc,
        },
      },
    });
    if (!client) return null;
    if (type && client.type !== type) return null;
    return client;
  }

  async findOrCreate(
    tenantId: string,
    input: CreateClientInput,
  ): Promise<{ client: Client; created: boolean }> {
    const normalizedDoc = input.documentNumber.trim();
    const normalizedName = input.name.trim().replace(/\s+/g, " ");

    const existing = await this.findByDocument(
      tenantId,
      input.documentType,
      normalizedDoc,
      input.type,
    );
    if (existing) {
      return { client: existing, created: false };
    }

    const client = await this.db.client.client.create({
      data: {
        tenantId,
        type: input.type,
        documentType: input.documentType,
        documentNumber: normalizedDoc,
        name: normalizedName,
        email: input.email?.trim().toLowerCase() || null,
        phone: input.phone?.trim() || null,
        address: input.address?.trim() || null,
        economicActivity: input.economicActivity?.trim() || null,
      },
    });

    return { client, created: true };
  }
}
