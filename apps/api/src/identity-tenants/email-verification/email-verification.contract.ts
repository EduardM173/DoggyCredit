export interface VerificationDelivery {
  emailDelivery: "SENT" | "TEST_INBOX" | "FAILED" | "UNAVAILABLE";
  retryAfterSeconds: number;
}

export interface VerifiedRequest {
  contactEmail: string;
  status: "PENDING_REVIEW";
}
