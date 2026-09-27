import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsString, IsUUID, Matches, Max, Min } from "class-validator";
export class AccessExchangeDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string;
}
export class ConfirmPlanDto {
  @ApiProperty() @IsUUID("4") planId!: string;
}
export class CreatePaymentDto {
  @ApiProperty({ enum: ["BANK_TRANSFER", "QR", "CARD"] }) @IsIn(["BANK_TRANSFER", "QR", "CARD"]) method!:
    "BANK_TRANSFER" | "QR" | "CARD";
}
export class IdempotencyDto {
  @IsUUID("4") key!: string;
}
export class DemoResultDto {
  @ApiProperty({ enum: ["PAID", "FAILED", "CANCELLED"] }) @IsIn(["PAID", "FAILED", "CANCELLED"]) result!:
    "PAID" | "FAILED" | "CANCELLED";
}
export class PageDto {
  @ApiPropertyOptional({ default: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
}
export class EmptyCommerceDto {}
