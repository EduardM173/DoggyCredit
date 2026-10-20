import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class PlanConfigurationDto {
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsString()
  @Matches(/^\d{1,12}(?:\.\d{1,2})?$/)
  price!: string;

  @IsIn(["BOB"])
  currency!: "BOB";

  @IsIn(["MONTHLY"])
  billingPeriod!: "MONTHLY";

  @IsBoolean()
  requiresPayment!: boolean;

  @IsIn(["NO_CONFIGURADO", "LIMITADO", "ILIMITADO"])
  evaluationLimitMode!: "NO_CONFIGURADO" | "LIMITADO" | "ILIMITADO";

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  evaluationsPerMonth?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  maxUsers?: number | null;

  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  features!: string[];
}

export class CreatePlanDto extends PlanConfigurationDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/)
  code!: string;
}

export class UpdatePlanDto extends PlanConfigurationDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class SetPlanStatusDto {
  @IsBoolean()
  active!: boolean;

  @IsInt()
  @Min(1)
  expectedRevision!: number;
}
