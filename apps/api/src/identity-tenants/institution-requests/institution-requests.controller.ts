import { Body, Controller, Post } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CreateInstitutionRequestDto } from "./create-institution-request.dto.js";
import { InstitutionRequestsService } from "./institution-requests.service.js";

@ApiTags("Identity & Tenants")
@Controller("institution-requests")
export class InstitutionRequestsController {
  constructor(private readonly requests: InstitutionRequestsService) {}

  @Post()
  @ApiOperation({
    summary: "Solicitar acceso institucional",
    description:
      "Crea una solicitud EMAIL_PENDING e intenta enviar la verificación. Un fallo de envío conserva la solicitud; no crea cuenta ni tenant.",
  })
  @ApiCreatedResponse({
    schema: {
      type: "object",
      required: ["id", "contactEmail", "status", "emailDelivery", "retryAfterSeconds"],
      properties: {
        id: { type: "string", format: "uuid" },
        contactEmail: { type: "string", format: "email" },
        status: { type: "string", enum: ["EMAIL_PENDING"] },
        emailDelivery: { type: "string", enum: ["SENT", "FAILED", "UNAVAILABLE"] },
        retryAfterSeconds: { type: "integer" },
      },
    },
  })
  @ApiBadRequestResponse({
    description: "Datos inválidos, campos administrativos o consentimientos ausentes.",
  })
  @ApiConflictResponse({ description: "Ya existe una solicitud con el NIT o correo normalizado." })
  create(@Body() input: CreateInstitutionRequestDto) {
    return this.requests.create(input);
  }
}
