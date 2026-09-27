export interface VerificationDelivery {
  emailDelivery: "SENT" | "FAILED" | "UNAVAILABLE";
  retryAfterSeconds: number;
}

export interface VerifiedRequest {
  contactEmail: string;
  status: "PENDING_REVIEW";
}
