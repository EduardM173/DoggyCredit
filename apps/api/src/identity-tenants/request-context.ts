import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";

export interface InstitutionContext {
  id: string;
  institutionName: string;
  contactName: string;
  contactEmail: string;
  planInterest: string | null;
  status: string;
}
@Injectable()
export class RequestContextReader {
  constructor(private readonly database: DatabaseUnitOfWork) {}
  async get(id: string): Promise<InstitutionContext> {
    const row = await this.database.client.institutionRequest.findUnique({
      where: { id },
      select: {
        id: true,
        institutionName: true,
        contactName: true,
        contactEmail: true,
        planInterest: true,
        status: true,
      },
    });
    if (!row) throw new NotFoundException("Solicitud no encontrada.");
    return row;
  }
  async approved(id: string): Promise<InstitutionContext> {
    const row = await this.get(id);
    if (row.status !== "APPROVED")
      throw new ConflictException("La solicitud no está aprobada para contratación.");
    return row;
  }
}
