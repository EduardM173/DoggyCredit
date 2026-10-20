import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class InviteOperatorDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;
}

export class PlatformTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}

export class AcceptOperatorDto extends PlatformTokenDto {
  @IsOptional()
  @IsString()
  password?: string;
}
