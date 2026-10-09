export type SelectableProduct = {
  id: string;
  name: string;
  category: string;
  applicantScope: string;
  minAmount: string;
  maxAmount: string;
  purposes: string[];
  selected: boolean;
};

export abstract class PreparationProducts {
  abstract list(tenantId: string): Promise<SelectableProduct[]>;
  abstract select(tenantId: string, ids: string[]): Promise<boolean>;
}
