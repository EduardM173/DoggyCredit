import { Controller, Get, Header } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PublicPlansService } from "./public-plans.service.js";

@ApiTags("Planes públicos")
@Controller("public/plans")
export class PublicPlansController {
  constructor(private readonly plans: PublicPlansService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list() {
    return this.plans.list();
  }
}
