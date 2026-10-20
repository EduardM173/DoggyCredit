import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, Matches, MaxLength } from "class-validator";

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const trimmed = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

/**
 * HU-34: campos institucionales autorizados para edicion.
 * Los datos legales (NIT, razon social, slug) y el responsable contractual
 * no forman parte de este contrato y permanecen bloqueados.
 */
export class UpdateInstitutionDataDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @Transform(trimmed)
  @IsString()
  @MaxLength(240)
  publicAddress?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.replace(/[\s()-]/g, "") : value,
  )
  @IsString()
  @Matches(/^\+[1-9][0-9]{7,14}$/, {
    message: "Ingresa un telefono valido con codigo de pais (por ejemplo, +59171234567).",
  })
  contactPhone?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: "Ingresa un correo electronico valido." })
  @MaxLength(254)
  contactEmail?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.replace(/[\s()-]/g, "") : value,
  )
  @IsString()
  @Matches(/^\+[1-9][0-9]{7,14}$/, {
    message: "Ingresa un telefono valido con codigo de pais (por ejemplo, +59171234567).",
  })
  supportPhone?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: "Ingresa un correo electronico valido." })
  @MaxLength(254)
  supportEmail?: string;
}
