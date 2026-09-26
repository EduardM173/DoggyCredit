import { Body, Controller, Get, Post } from "@nestjs/common";
import { TenantId } from "../tenant/tenant-id.decorator.js";
import { ClientsService } from "./clients.service.js";
import { CreateClientDto } from "./dto/create-client.dto.js";

@Controller("clients")
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  findAll(@TenantId() tenantId: string) {
    return this.clientsService.findAll(tenantId);
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() input: CreateClientDto) {
    return this.clientsService.create(tenantId, input);
  }
}
