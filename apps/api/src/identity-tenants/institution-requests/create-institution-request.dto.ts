import { Transform } from "class-transformer";
import { Equals, IsEmail, IsIn, IsNotEmpty, IsString, Matches, MaxLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import {
  INSTITUTION_TYPES,
  PLAN_INTERESTS,
  type SubmitInstitutionRequest,
} from "./institution-request.contract.js";

const trimmed = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class CreateInstitutionRequestDto implements SubmitInstitutionRequest {
  @ApiProperty({ maxLength: 180, example: "Banco del Sol S.A." })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: "Ingresa el nombre o razón social." })
  @MaxLength(180)
  institutionName!: string;

  @ApiProperty({
    maxLength: 40,
    example: "1234567890",
    description: "NIT; espacios y guiones se normalizan.",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.replace(/[\s-]/g, "") : value,
  )
  @IsString()
  @Matches(/^[0-9]{1,40}$/, { message: "Ingresa un NIT de hasta 40 dígitos." })
  taxId!: string;

  @ApiProperty({ enum: INSTITUTION_TYPES })
  @IsIn(INSTITUTION_TYPES, { message: "Selecciona un tipo de institución válido." })
  institutionType!: SubmitInstitutionRequest["institutionType"];

  @ApiProperty({ enum: PLAN_INTERESTS, description: "Interés provisional, no asigna un plan comercial." })
  @IsIn(PLAN_INTERESTS, { message: "Selecciona un plan de interés válido." })
  planInterest!: (typeof PLAN_INTERESTS)[number];

  @ApiProperty({ maxLength: 140 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: "Ingresa el nombre de la persona responsable." })
  @MaxLength(140)
  contactName!: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: "Ingresa el cargo de la persona responsable." })
  @MaxLength(120)
  contactRole!: string;

  @ApiProperty({ maxLength: 254, example: "ana@bancodelsol.com" })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: "Ingresa un correo electrónico válido." })
  @MaxLength(254)
  contactEmail!: string;

  @ApiProperty({ example: "+59171234567", description: "Número internacional, de 8 a 15 dígitos." })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.replace(/[\s()-]/g, "") : value,
  )
  @IsString()
  @Matches(/^\+[1-9][0-9]{7,14}$/, {
    message: "Ingresa un teléfono válido con código de país (por ejemplo, +59171234567).",
  })
  contactPhone!: string;

  @ApiProperty({
    type: Boolean,
    enum: [true],
    description: "Confirmación del formulario; no se persiste como evidencia legal.",
  })
  @Equals(true, { message: "Confirma que representas a la institución." })
  representsInstitution!: boolean;

  @ApiProperty({
    type: Boolean,
    enum: [true],
    description: "Aceptación del formulario; no se persiste como evidencia legal.",
  })
  @Equals(true, { message: "Acepta los términos de uso y la política de privacidad." })
  acceptsTerms!: boolean;
}
