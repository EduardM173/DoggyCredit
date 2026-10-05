import { IsArray, IsIn, IsNotEmpty, IsString, IsUUID, MaxLength } from "class-validator";

export class ConfirmInstitutionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  name!: string;

  @IsIn(["BANK", "FINANCIAL_INSTITUTION", "COOPERATIVE", "OTHER"])
  type!: "BANK" | "FINANCIAL_INSTITUTION" | "COOPERATIVE" | "OTHER";
}

export class ConfirmProductsDto {
  @IsArray()
  @IsUUID("4", { each: true })
  productIds!: string[];
}
