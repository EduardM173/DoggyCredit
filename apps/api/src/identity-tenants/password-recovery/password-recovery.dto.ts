import { IsEmail, IsString, Matches, MaxLength } from "class-validator";

export class RequestPasswordResetDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}

export class CompletePasswordResetDto extends ResetTokenDto {
  @IsString()
  password!: string;

  @IsString()
  confirmation!: string;
}
