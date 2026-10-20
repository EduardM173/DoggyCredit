import { Transform, Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import type { AuditCategory, AuditOutcome } from "./audit.dto.js";

const categories: AuditCategory[] = [
  "EVALUATION",
  "CATALOG",
  "TEAM",
  "INSTITUTION",
  "OPERATIONS",
  "PLATFORM",
];

const outcomes: AuditOutcome[] = ["SUCCESS", "FAILURE", "INFO"];

export class AuditQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ description: "Fecha de inicio del filtro (ISO 8601 o YYYY-MM-DD)" })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: "Fecha de fin del filtro (ISO 8601 o YYYY-MM-DD)" })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: categories, description: "Categoría de eventos" })
  @IsOptional()
  @IsIn(categories)
  category?: AuditCategory;

  @ApiPropertyOptional({ description: "Código de acción exacto a filtrar", maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  action?: string;

  @ApiPropertyOptional({ enum: outcomes, description: "Resultado de la acción" })
  @IsOptional()
  @IsIn(outcomes)
  outcome?: AuditOutcome;
}

export class PlatformAuditQueryDto extends AuditQueryDto {
  @ApiPropertyOptional({ description: "Identificador de institución para filtrar auditoría operativa" })
  @IsOptional()
  @IsUUID("4")
  tenantId?: string;
}
