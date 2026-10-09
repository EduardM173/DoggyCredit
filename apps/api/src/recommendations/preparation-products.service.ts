import { BadRequestException, Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { PreparationProducts, type SelectableProduct } from "./public.js";

@Injectable()
export class PreparationProductsService extends PreparationProducts {
  constructor(private readonly db: DatabaseUnitOfWork) {
    super();
  }

  async list(tenantId: string): Promise<SelectableProduct[]> {
    const rows = await this.db.client.financialProduct.findMany({
      where: { tenantId },
      include: { purposes: { select: { purpose: true } } },
      orderBy: { name: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      applicantScope: row.applicantScope,
      minAmount: row.minAmount.toString(),
      maxAmount: row.maxAmount.toString(),
      purposes: row.purposes.map((item) => item.purpose),
      selected: row.active,
    }));
  }

  async select(tenantId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    const existing = await this.db.client.financialProduct.findMany({
      where: { tenantId },
      select: { id: true, active: true, applicantScope: true },
    });
    if (unique.length === 0 || unique.some((id) => !existing.some((row) => row.id === id)))
      throw new BadRequestException("Selecciona al menos un producto disponible de tu institución.");
    if (!existing.some((row) => unique.includes(row.id) && row.applicantScope !== "COMPANY"))
      throw new BadRequestException("Selecciona al menos un producto para personas.");
    const selected = new Set(unique);
    const changed = existing.some((row) => row.active !== selected.has(row.id));
    if (!changed) return false;
    await this.db.client.financialProduct.updateMany({
      where: { tenantId, id: { in: unique } },
      data: { active: true },
    });
    await this.db.client.financialProduct.updateMany({
      where: { tenantId, id: { notIn: unique } },
      data: { active: false },
    });
    return true;
  }
}
