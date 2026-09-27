export const REQUEST_STATUSES = ["EMAIL_PENDING", "PENDING_REVIEW", "APPROVED", "REJECTED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export interface RequestSearch {
  search?: string;
  status?: RequestStatus;
  date?: string;
  page: number;
  pageSize: number;
}
export interface ReviewItem {
  id: string;
  institutionName: string;
  taxId: string;
  contactEmail: string;
  planInterest: string | null;
  status: RequestStatus;
  createdAt: string;
}
export interface ReviewDetail extends ReviewItem {
  institutionType: string;
  contactName: string;
  contactRole: string;
  contactPhone: string | null;
  emailVerifiedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  reviewer: { fullName: string } | null;
}
export interface ReviewList {
  items: ReviewItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
