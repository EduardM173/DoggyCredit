import { ClientType, DocumentType } from "../../generated/prisma/client.js";
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateClientDto {
  @IsEnum(ClientType)
  type!: ClientType;

  @IsEnum(DocumentType)
  documentType!: DocumentType;

  @IsString()
  @MaxLength(60)
  documentNumber!: string;

  @IsString()
  @MaxLength(180)
  name!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  economicActivity?: string;
}
