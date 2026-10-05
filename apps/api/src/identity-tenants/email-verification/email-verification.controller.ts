import { Body, Controller, Header, HttpCode, Post } from "@nestjs/common";
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { EmailVerificationService } from "./email-verification.service.js";
import { ResendVerificationDto, VerifyEmailDto } from "./email-verification.dto.js";

@ApiTags("Identity & Tenants")
@Controller("institution-requests/email-verification")
export class EmailVerificationController {
  constructor(private readonly verification: EmailVerificationService) {}

  @Post("verify")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @ApiOperation({ summary: "Verificar correo; solo cambia EMAIL_PENDING a PENDING_REVIEW" })
  @ApiOkResponse({
    schema: {
      type: "object",
      properties: {
        contactEmail: { type: "string", format: "email" },
        status: { type: "string", enum: ["PENDING_REVIEW"] },
      },
    },
  })
  @ApiBadRequestResponse({ description: "Token inválido, vencido, utilizado, invalidado o no enviado." })
  verify(@Body() body: VerifyEmailDto) {
    return this.verification.verify(body.token);
  }

  @Post("resend")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Reenviar verificación usando la referencia UUID de la solicitud" })
  @ApiOkResponse({
    schema: {
      type: "object",
      properties: {
        emailDelivery: { type: "string", enum: ["SENT", "FAILED", "UNAVAILABLE"] },
        retryAfterSeconds: { type: "integer" },
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: "Cooldown persistente. Retry-After y retryAfterSeconds indican segundos restantes.",
  })
  resend(@Body() body: ResendVerificationDto) {
    return this.verification.send(body.requestId);
  }
}
