import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class InstitutionSearchDto {
  @ApiPropertyOptional({ maxLength: 180 })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ enum: ["INVITED", "ACTIVE", "SUSPENDED"] })
  @IsOptional()
  @IsIn(["INVITED", "ACTIVE", "SUSPENDED"])
  activationStatus?: "INVITED" | "ACTIVE" | "SUSPENDED";

  @ApiPropertyOptional({ description: "Código del plan (BASIC, PROFESSIONAL, ENTERPRISE)" })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;

  @ApiPropertyOptional({ default: 10, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 10;
}
