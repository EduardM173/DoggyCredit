import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { Transform } from "class-transformer";
export const ApplicantScope = {
  PERSON: "PERSON",
  COMPANY: "COMPANY",
  BOTH: "BOTH",
} as const;
export type ApplicantScope = (typeof ApplicantScope)[keyof typeof ApplicantScope];

export const CreditPurpose = {
  WORKING_CAPITAL: "WORKING_CAPITAL",
  GREEN_PROJECT: "GREEN_PROJECT",
  BUSINESS_INVESTMENT: "BUSINESS_INVESTMENT",
  EQUIPMENT: "EQUIPMENT",
  OTHER: "OTHER",
} as const;
export type CreditPurpose = (typeof CreditPurpose)[keyof typeof CreditPurpose];

export const ProductCategory = {
  MICRO_CREDIT: "MICRO_CREDIT",
  GREEN_CREDIT: "GREEN_CREDIT",
  SME_CREDIT: "SME_CREDIT",
  OTHER: "OTHER",
} as const;
export type ProductCategory = (typeof ProductCategory)[keyof typeof ProductCategory];

export class CreateProductDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString({ message: "El nombre del producto debe ser texto." })
  @MaxLength(160, { message: "El nombre no puede exceder los 160 caracteres." })
  name!: string;

  @IsEnum(ProductCategory, { message: "Categoría de producto inválida." })
  category!: ProductCategory;

  @IsEnum(ApplicantScope, { message: "Alcance de solicitante inválido." })
  applicantScope!: ApplicantScope;

  @IsArray({ message: "Las finalidades deben especificarse en una lista." })
  purposes!: CreditPurpose[];

  @IsNumber({}, { message: "El monto mínimo debe ser un número." })
  @IsPositive({ message: "El monto mínimo debe ser mayor a cero." })
  minAmount!: number;

  @IsNumber({}, { message: "El monto máximo debe ser un número." })
  @IsPositive({ message: "El monto máximo debe ser mayor a cero." })
  maxAmount!: number;

  @IsOptional()
  @IsNumber({}, { message: "La relación deuda/ingreso máxima debe ser numérica." })
  @Min(0.01, { message: "La relación deuda/ingreso debe ser positiva." })
  maxDebtToIncome?: number | null;

  @IsOptional()
  @IsNumber({}, { message: "El ingreso mensual disponible mínimo debe ser numérico." })
  @Min(0, { message: "El ingreso mensual disponible mínimo no puede ser negativo." })
  minMonthlyDisposableIncome?: number | null;

  @IsOptional()
  @IsBoolean({ message: "allowsRecentArrears debe ser booleano." })
  allowsRecentArrears?: boolean;

  @IsOptional()
  @IsBoolean({ message: "El estado activo debe ser booleano." })
  active?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString({ message: "El nombre del producto debe ser texto." })
  @MaxLength(160, { message: "El nombre no puede exceder los 160 caracteres." })
  name?: string;

  @IsOptional()
  @IsEnum(ProductCategory, { message: "Categoría de producto inválida." })
  category?: ProductCategory;

  @IsOptional()
  @IsEnum(ApplicantScope, { message: "Alcance de solicitante inválido." })
  applicantScope?: ApplicantScope;

  @IsOptional()
  @IsArray({ message: "Las finalidades deben especificarse en una lista." })
  purposes?: CreditPurpose[];

  @IsOptional()
  @IsNumber({}, { message: "El monto mínimo debe ser un número." })
  @IsPositive({ message: "El monto mínimo debe ser mayor a cero." })
  minAmount?: number;

  @IsOptional()
  @IsNumber({}, { message: "El monto máximo debe ser un número." })
  @IsPositive({ message: "El monto máximo debe ser mayor a cero." })
  maxAmount?: number;

  @IsOptional()
  @IsNumber({}, { message: "La relación deuda/ingreso máxima debe ser numérica." })
  maxDebtToIncome?: number | null;

  @IsOptional()
  @IsNumber({}, { message: "El ingreso mensual disponible mínimo debe ser numérico." })
  minMonthlyDisposableIncome?: number | null;

  @IsOptional()
  @IsBoolean({ message: "allowsRecentArrears debe ser booleano." })
  allowsRecentArrears?: boolean;

  @IsOptional()
  @IsBoolean({ message: "El estado activo debe ser booleano." })
  active?: boolean;
}

export class ToggleProductStatusDto {
  @IsBoolean({ message: "El estado activo debe ser booleano." })
  active!: boolean;

  @IsOptional()
  @IsBoolean({ message: "confirmImpact debe ser booleano." })
  confirmImpact?: boolean;
}

export interface ProductCatalogItemDto {
  id: string;
  tenantId: string;
  name: string;
  category: ProductCategory;
  applicantScope: ApplicantScope;
  minAmount: number;
  maxAmount: number;
  maxDebtToIncome: number | null;
  minMonthlyDisposableIncome: number | null;
  allowsRecentArrears: boolean;
  active: boolean;
  purposes: CreditPurpose[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DeactivationImpactDto {
  isLastActive: boolean;
  scope: ApplicantScope | null;
  warningMessage?: string;
}
