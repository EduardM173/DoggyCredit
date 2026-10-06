import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type, Transform } from "class-transformer";
import {
  Equals,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { documentTypes, type PersonDocumentType } from "../clients/public.js";
export const creditPurposes = [
  "WORKING_CAPITAL",
  "GREEN_PROJECT",
  "BUSINESS_INVESTMENT",
  "EQUIPMENT",
  "OTHER",
] as const;
export class DocumentDto {
  @ApiProperty({ enum: documentTypes }) @IsIn(documentTypes) documentType!: PersonDocumentType;
  @ApiProperty({ example: "7812456" })
  @IsString()
  @MaxLength(60)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  )
  documentNumber!: string;
}
export class PersonDto {
  @ApiProperty() @IsString() @MaxLength(90) firstName!: string;
  @ApiProperty() @IsString() @MaxLength(90) lastName!: string;
  @ApiProperty({ example: "1998-07-14" }) @IsString() birthDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
}
export class PrepareEvaluationDto extends DocumentDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID("4") clientId?: string;
  @ApiPropertyOptional({ type: PersonDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PersonDto)
  person?: PersonDto;
  @ApiProperty({ enum: creditPurposes }) @IsIn(creditPurposes) purpose!: (typeof creditPurposes)[number];
  @ApiProperty({
    example: "120000.00",
    description: "Monto positivo en BOB, como string decimal con hasta dos decimales.",
  })
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/)
  requestedAmount!: string;
  @ApiProperty({ example: true })
  @Equals(true, { message: "Debes confirmar el consentimiento antes de iniciar." })
  consent!: boolean;
  @ApiProperty() @IsUUID("4") idempotencyKey!: string;
}
