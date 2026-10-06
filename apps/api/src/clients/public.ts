export const documentTypes = ["CI", "PASSPORT", "OTHER"] as const;
export type PersonDocumentType = (typeof documentTypes)[number];
export type PersonInput = { firstName: string; lastName: string; birthDate: string; phone?: string };
export type Applicant = {
  id: string;
  type: "PERSON";
  documentType: PersonDocumentType;
  documentNumber: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  phone: string | null;
};
export abstract class ApplicantRecords {
  abstract find(
    tenantId: string,
    documentType: PersonDocumentType,
    documentNumber: string,
  ): Promise<Applicant | null>;
  abstract resolve(
    tenantId: string,
    documentType: PersonDocumentType,
    documentNumber: string,
    clientId?: string,
    person?: PersonInput,
  ): Promise<Applicant>;
}
