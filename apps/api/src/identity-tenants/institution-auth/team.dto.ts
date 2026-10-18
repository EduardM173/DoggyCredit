import { Transform } from "class-transformer";
import { IsEmail, IsIn, IsOptional, MaxLength } from "class-validator";

export class InviteAnalystDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsIn(["ANALYST", "INSTITUTION_ADMIN"])
  role?: "ANALYST" | "INSTITUTION_ADMIN";
}
