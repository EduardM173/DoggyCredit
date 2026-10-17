import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  InstitutionOriginGuard,
  InstitutionSessionGuard,
  TenantContextGuard,
  type TenantRequest,
} from "../identity-tenants/public.js";
import { ProductsCatalogService } from "./products-catalog.service.js";
import {
  CreateProductDto,
  ToggleProductStatusDto,
  UpdateProductDto,
} from "./products-catalog.dto.js";

@ApiTags("Portal institucional - catálogo de productos")
@ApiCookieAuth()
@Controller("institution/tenants/:tenantSlug/products")
@UseGuards(InstitutionSessionGuard, TenantContextGuard)
export class ProductsCatalogController {
  constructor(private readonly catalog: ProductsCatalogService) {}

  @Get("catalog")
  @ApiOperation({ summary: "Listar catálogo completo de productos de la institución" })
  list(@Req() request: TenantRequest) {
    return this.catalog.list(request.tenantContext);
  }

  @Get("catalog/:id")
  @ApiOperation({ summary: "Obtener detalle de un producto por ID" })
  getById(
    @Req() request: TenantRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ) {
    return this.catalog.getById(request.tenantContext, id);
  }

  @Get("catalog/:id/deactivation-impact")
  @ApiOperation({ summary: "Verificar impacto de desactivar un producto para la institución" })
  checkImpact(
    @Req() request: TenantRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ) {
    return this.catalog.checkDeactivationImpact(request.tenantContext.tenantId, id);
  }

  @Post("catalog")
  @HttpCode(201)
  @UseGuards(InstitutionOriginGuard)
  @ApiOperation({ summary: "Crear un nuevo producto crediticio para la institución" })
  create(@Req() request: TenantRequest, @Body() body: CreateProductDto) {
    return this.catalog.create(request.tenantContext, body);
  }

  @Put("catalog/:id")
  @UseGuards(InstitutionOriginGuard)
  @ApiOperation({ summary: "Modificar condiciones de un producto crediticio" })
  update(
    @Req() request: TenantRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: UpdateProductDto,
  ) {
    return this.catalog.update(request.tenantContext, id, body);
  }

  @Patch("catalog/:id/status")
  @UseGuards(InstitutionOriginGuard)
  @ApiOperation({ summary: "Activar o desactivar un producto crediticio" })
  toggleStatus(
    @Req() request: TenantRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: ToggleProductStatusDto,
  ) {
    return this.catalog.toggleStatus(
      request.tenantContext,
      id,
      body.active,
      Boolean(body.confirmImpact),
    );
  }
}
