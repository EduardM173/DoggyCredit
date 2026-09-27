import { IsString, IsUUID, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class VerifyEmailDto {
  @ApiProperty({ description: "Token de un solo uso recibido por correo", minLength: 43, maxLength: 43 })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: "El enlace de verificación no es válido." })
  token!: string;
}

export class ResendVerificationDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4")
  requestId!: string;
}
