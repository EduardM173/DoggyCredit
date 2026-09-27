import { IsOptional, IsString, Matches } from "class-validator";

export class InvitationPreviewDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}

export class ActivateInvitationDto extends InvitationPreviewDto {
  @IsOptional()
  @IsString()
  password?: string;
}
