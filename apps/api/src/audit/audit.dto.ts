import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export type AuditCategory =
  | "EVALUATION"
  | "CATALOG"
  | "TEAM"
  | "INSTITUTION"
  | "OPERATIONS"
  | "PLATFORM";

export type AuditOutcome = "SUCCESS" | "FAILURE" | "INFO";

export class AuditActorDto {
  @ApiProperty({ enum: ["USER", "SYSTEM", "OPERATOR"] })
  type!: "USER" | "SYSTEM" | "OPERATOR";

  @ApiProperty({ description: "Nombre visible del actor o del sistema" })
  name!: string;

  @ApiPropertyOptional({ description: "Correo electrónico del usuario responsable" })
  email?: string | null;
}

export class AuditEventDto {
  @ApiProperty({ description: "Identificador del evento de auditoría" })
  id!: string;

  @ApiProperty({ description: "Marca temporal en formato ISO 8601 con zona horaria" })
  occurredAt!: string;

  @ApiProperty({ description: "Código formal de la acción" })
  action!: string;

  @ApiProperty({ description: "Descripción legible de la acción en español" })
  actionLabel!: string;

  @ApiProperty({ enum: ["EVALUATION", "CATALOG", "TEAM", "INSTITUTION", "OPERATIONS", "PLATFORM"] })
  category!: AuditCategory;

  @ApiProperty({ enum: ["SUCCESS", "FAILURE", "INFO"] })
  outcome!: AuditOutcome;

  @ApiProperty({ description: "Tipo de entidad de negocio afectada" })
  entityType!: string;

  @ApiProperty({ description: "Nombre legible de la entidad" })
  entityLabel!: string;

  @ApiPropertyOptional({ description: "Identificador opcional de la entidad de negocio" })
  entityId?: string | null;

  @ApiPropertyOptional({ description: "Enlace seguro al recurso si el observador tiene permiso" })
  resourceLink?: string | null;

  @ApiProperty({ type: AuditActorDto })
  actor!: AuditActorDto;

  @ApiProperty({ description: "Resumen comprensible de la operación" })
  summary!: string;

  @ApiPropertyOptional({ description: "Metadatos seguros sanitizados (sin PII, secretos ni tokens)" })
  metadata?: Record<string, unknown> | null;
}

export class AuditPageDto {
  @ApiProperty({ type: [AuditEventDto] })
  items!: AuditEventDto[];

  @ApiProperty({ description: "Total de registros que coinciden con los filtros autorizados" })
  total!: number;

  @ApiProperty({ description: "Página actual (1-based)" })
  page!: number;

  @ApiProperty({ description: "Cantidad de elementos por página" })
  pageSize!: number;

  @ApiProperty({ description: "Total de páginas disponibles" })
  totalPages!: number;
}
