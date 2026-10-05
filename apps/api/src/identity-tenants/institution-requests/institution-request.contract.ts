export const INSTITUTION_TYPES = ["BANK", "FINANCIAL_INSTITUTION", "COOPERATIVE", "OTHER"] as const;

// Application input after HTTP validation and normalization; not a persistence model.
export interface SubmitInstitutionRequest {
  institutionName: string;
  taxId: string;
  institutionType: (typeof INSTITUTION_TYPES)[number];
  planInterest: string;
  contactName: string;
  contactRole: string;
  contactEmail: string;
  contactPhone: string;
}

export interface InstitutionRequestReceipt {
  id: string;
  contactEmail: string;
  status: "EMAIL_PENDING";
  emailDelivery: "SENT" | "FAILED" | "UNAVAILABLE";
  retryAfterSeconds: number;
}
