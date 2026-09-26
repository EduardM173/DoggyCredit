import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

@ApiTags("health")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOperation({ summary: "Comprueba que la API está disponible" })
  @ApiOkResponse({
    schema: {
      example: { status: "ok", service: "doggycredit-api" },
    },
  })
  status() {
    return { status: "ok", service: "doggycredit-api" };
  }
}
