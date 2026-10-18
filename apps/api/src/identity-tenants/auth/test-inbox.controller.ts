import { Controller, Get, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { TestInbox } from "../../infrastructure/email/test-inbox-email.adapter.js";
import { AdminAuthGuard, OperatorGuard } from "./admin-auth.guards.js";

@ApiTags("Administración - bandeja de pruebas")
@ApiCookieAuth()
@Controller("admin/test-inbox")
@UseGuards(AdminAuthGuard, OperatorGuard)
export class TestInboxController {
  constructor(
    private readonly config: ConfigService,
    private readonly inbox: TestInbox,
  ) {}

  @Get()
  @ApiOperation({ summary: "Consultar correos simulados de la demostración local" })
  list() {
    if (this.config.getOrThrow<string>("EMAIL_TRANSPORT") !== "test_inbox")
      return { enabled: false, messages: [] };
    return { enabled: true, messages: this.inbox.list() };
  }
}
