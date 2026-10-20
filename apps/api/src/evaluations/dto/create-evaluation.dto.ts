import { Type } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum DocumentTypeDto {
  CI = "CI",
  NIT = "NIT",
  PASSPORT = "PASSPORT",
  OTHER = "OTHER",
}

export enum ClientTypeDto {
  PERSON = "PERSON",
  COMPANY = "COMPANY",
}

export enum CreditPurposeDto {
  WORKING_CAPITAL = "WORKING_CAPITAL",
  GREEN_PROJECT = "GREEN_PROJECT",
  BUSINESS_INVESTMENT = "BUSINESS_INVESTMENT",
  EQUIPMENT = "EQUIPMENT",
  OTHER = "OTHER",
}

export class CreateEvaluationDto {
  @ApiPropertyOptional({ enum: ClientTypeDto, default: ClientTypeDto.PERSON })
  @IsOptional()
  @IsEnum(ClientTypeDto)
  clientType?: ClientTypeDto = ClientTypeDto.PERSON;

  @ApiProperty({ enum: DocumentTypeDto, default: DocumentTypeDto.CI })
  @IsEnum(DocumentTypeDto)
  documentType: DocumentTypeDto = DocumentTypeDto.CI;

  @ApiProperty({ description: "Número de documento del solicitante", example: "4892019" })
  @IsString()
  @IsNotEmpty({ message: "Introduce el número de documento." })
  @MinLength(3, { message: "El documento debe tener al menos 3 caracteres." })
  @MaxLength(60, { message: "El documento no puede superar 60 caracteres." })
  documentNumber!: string;

  @ApiProperty({
    description: "Nombre completo del solicitante o razón social de la empresa",
    example: "Carlos Quispe",
  })
  @IsString()
  @IsNotEmpty({ message: "Introduce el nombre del solicitante." })
  @MinLength(2, { message: "El nombre debe tener al menos 2 caracteres." })
  @MaxLength(180, { message: "El nombre no puede superar 180 caracteres." })
  name!: string;

  @ApiPropertyOptional({ description: "Actividad económica de la empresa", example: "Comercio mayorista" })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  economicActivity?: string;

  @ApiProperty({ enum: CreditPurposeDto, example: CreditPurposeDto.WORKING_CAPITAL })
  @IsEnum(CreditPurposeDto, { message: "Selecciona una finalidad crediticia válida." })
  purpose!: CreditPurposeDto;

  @ApiProperty({ description: "Monto solicitado en la moneda de la institución", example: 15000 })
  @Type(() => Number)
  @IsNumber({}, { message: "El monto debe ser un número válido." })
  @Min(100, { message: "El monto solicitado debe ser de al menos 100." })
  requestedAmount!: number;

  @ApiProperty({ description: "Consentimiento informado del solicitante", example: true })
  @IsBoolean({ message: "El consentimiento debe ser verdadero o falso." })
  @Equals(true, { message: "Debes registrar el consentimiento del solicitante para iniciar la evaluación." })
  consentGiven!: boolean;

  @ApiProperty({ description: "Clave estable de idempotencia para esta operación lógica" })
  @IsString()
  @IsNotEmpty({ message: "La clave de operación es obligatoria para iniciar una evaluación." })
  @MinLength(16, { message: "La clave de operación no es válida." })
  @MaxLength(80)
  idempotencyKey?: string;
}
