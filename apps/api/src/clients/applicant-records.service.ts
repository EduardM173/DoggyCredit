import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import {
  ApplicantRecords,
  documentTypes,
  type Applicant,
  type PersonDocumentType,
  type PersonInput,
} from "./public.js";

export function validateDocument(type: PersonDocumentType, value: string) {
  if (
    !documentTypes.includes(type) ||
    !value ||
    value.length > 60 ||
    !/^[\p{L}\p{N} -]+$/u.test(value) ||
    (type === "CI" && !/^\d+(?:-[A-Z0-9]+)?$/.test(value))
  )
    throw new BadRequestException("Ingresa un documento válido.");
}
export function validatePerson(person: PersonInput) {
  for (const value of [person.firstName, person.lastName])
    if (!value?.trim() || value.length > 90 || !/^[\p{L}\p{M} '\u2019-]+$/u.test(value))
      throw new BadRequestException("Revisa los nombres y apellidos del solicitante.");
  const date = new Date(person.birthDate);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(person.birthDate) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== person.birthDate ||
    date > new Date() ||
    date.getUTCFullYear() < 1
  )
    throw new BadRequestException("La fecha de nacimiento debe ser una fecha real, no futura.");
  if (person.phone && (person.phone.length > 40 || !/^\+?[0-9 ()-]+$/.test(person.phone)))
    throw new BadRequestException("Revisa el teléfono ingresado.");
}
@Injectable()
export class ApplicantRecordsService extends ApplicantRecords {
  constructor(private readonly db: DatabaseUnitOfWork) {
    super();
  }
  private view(row: {
    id: string;
    type: string;
    documentType: string;
    documentNumber: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    birthDate: Date | null;
    phone: string | null;
  }): Applicant {
    if (row.type !== "PERSON") throw new ConflictException("Este expediente no corresponde a una persona.");
    return {
      id: row.id,
      type: "PERSON",
      documentType: row.documentType as PersonDocumentType,
      documentNumber: row.documentNumber,
      name: row.name,
      firstName: row.firstName,
      lastName: row.lastName,
      birthDate: row.birthDate?.toISOString().slice(0, 10) ?? null,
      phone: row.phone,
    };
  }
  async find(tenantId: string, documentType: PersonDocumentType, documentNumber: string) {
    validateDocument(documentType, documentNumber);
    const row = await this.db.client.client.findUnique({
      where: { tenantId_documentType_documentNumber: { tenantId, documentType, documentNumber } },
    });
    return row ? this.view(row) : null;
  }
  async resolve(
    tenantId: string,
    documentType: PersonDocumentType,
    documentNumber: string,
    clientId?: string,
    person?: PersonInput,
  ) {
    const existing = await this.find(tenantId, documentType, documentNumber);
    if (clientId) {
      if (!existing || existing.id !== clientId) throw new NotFoundException("Expediente no encontrado.");
      return existing;
    }
    if (!person) throw new BadRequestException("Completa los datos mínimos del solicitante.");
    validatePerson(person);
    if (existing) {
      if (
        existing.firstName !== person.firstName.trim() ||
        existing.lastName !== person.lastName.trim() ||
        existing.birthDate !== person.birthDate ||
        existing.phone !== (person.phone?.trim() || null)
      )
        throw new ConflictException(
          "El expediente fue registrado por otra persona. Busca nuevamente el documento para confirmar sus datos.",
        );
      return existing;
    }
    const row = await this.db.client.client.upsert({
      where: { tenantId_documentType_documentNumber: { tenantId, documentType, documentNumber } },
      update: {},
      create: {
        tenantId,
        type: "PERSON",
        documentType,
        documentNumber,
        name: person.firstName.trim() + " " + person.lastName.trim(),
        firstName: person.firstName.trim(),
        lastName: person.lastName.trim(),
        birthDate: new Date(person.birthDate),
        phone: person.phone?.trim() || null,
      },
    });
    return this.view(row);
  }
}
