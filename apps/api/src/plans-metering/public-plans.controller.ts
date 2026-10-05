import { Controller, Get, Header } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PublicPlansService } from "./public-plans.service.js";

@ApiTags("Planes públicos")
@Controller("public/plans")
export class PublicPlansController {
  constructor(private readonly plans: PublicPlansService) {}

  @Get()
  @Header("Cache-Control", "public, max-age=60")
  list() {
    return this.plans.list();
  }
}
