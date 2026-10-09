export abstract class BankMockSource {
  abstract status(tenantId: string): Promise<{ available: boolean; enabled: boolean }>;
  abstract enable(tenantId: string): Promise<boolean>;
}
