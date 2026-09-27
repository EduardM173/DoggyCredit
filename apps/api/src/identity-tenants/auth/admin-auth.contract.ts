export interface AdminIdentity {
  id: string;
  fullName: string;
  email: string;
  platformRole: "PLATFORM_ADMIN" | "OPERATOR" | null;
}
export interface AdminSessionView {
  user: AdminIdentity;
  expiresAt: string;
}
