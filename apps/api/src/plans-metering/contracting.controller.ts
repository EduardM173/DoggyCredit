import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import {
  AdminAuthGuard,
  AdminOriginGuard,
  OperatorGuard,
  type AdminRequest,
} from "../identity-tenants/public.js";
import { PaymentProvider } from "../infrastructure/payments/payment-provider.js";
import { ContractingAccessService } from "./contracting-access.service.js";
import { ContractingService } from "./contracting.service.js";
import { PaymentEventProcessor } from "./payment-event-processor.js";
import {
  CONTRACTING_COOKIE,
  ContractingGuard,
  PaymentPublicRateGuard,
  type ContractingRequest,
} from "./contracting.guards.js";
import {
  AccessExchangeDto,
  ConfirmPlanDto,
  CreatePaymentDto,
  DemoResultDto,
  PageDto,
  EmptyCommerceDto,
} from "./contracting.dto.js";

@ApiTags("Contratación")
@Controller("contracting")
export class ContractingController {
  constructor(
    private readonly access: ContractingAccessService,
    private readonly service: ContractingService,
    private readonly config: ConfigService,
  ) {}
  @Post("access")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard, PaymentPublicRateGuard)
  async exchange(@Body() body: AccessExchangeDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.access.exchange(body.token);
    response.cookie(CONTRACTING_COOKIE, session.token, {
      httpOnly: true,
      secure: this.config.get("NODE_ENV") === "production",
      sameSite: "strict",
      path: "/api/contracting",
      expires: session.expiresAt,
    });
    return { expiresAt: session.expiresAt.toISOString() };
  }
  @Get("context")
  @UseGuards(ContractingGuard)
  context(@Req() req: ContractingRequest) {
    return this.service.context(req.institutionRequestId);
  }
  @Post("plan")
  @HttpCode(200)
  @UseGuards(ContractingGuard, AdminOriginGuard)
  plan(@Req() req: ContractingRequest, @Body() body: ConfirmPlanDto) {
    return this.service.confirmPlan(req.institutionRequestId, body.planId);
  }
  @Post("payment")
  @HttpCode(200)
  @UseGuards(ContractingGuard, AdminOriginGuard)
  async payment(
    @Req() req: ContractingRequest,
    @Body() body: CreatePaymentDto,
    @Headers("idempotency-key") key: string,
  ) {
    await new ParseUUIDPipe({ version: "4" }).transform(key, { type: "custom" });
    return this.service.createPayment(req.institutionRequestId, body.method, key);
  }
  @Post("payment/checkout")
  @HttpCode(200)
  @UseGuards(ContractingGuard, AdminOriginGuard, PaymentPublicRateGuard)
  checkout(@Req() req: ContractingRequest, @Body() body: EmptyCommerceDto) {
    void body;
    return this.service.checkout(req.institutionRequestId);
  }
  @Get("payment/status")
  @UseGuards(ContractingGuard)
  status(@Req() req: ContractingRequest) {
    return this.service.status(req.institutionRequestId);
  }
}

@ApiTags("Administración - contratación")
@Controller("admin")
@UseGuards(AdminAuthGuard, OperatorGuard)
export class AdminContractingController {
  constructor(
    private readonly access: ContractingAccessService,
    private readonly service: ContractingService,
  ) {}
  @Post("institution-requests/:id/contracting-access")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard)
  issue(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() req: AdminRequest,
    @Body() body: EmptyCommerceDto,
  ) {
    void body;
    return this.access.issue(id, req.adminSession.user.id);
  }
  @Get("contractings")
  list(@Query() query: PageDto) {
    return this.service.adminList(query.page);
  }
  @Post("contractings/payments/:id/simulate")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard)
  simulate(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: DemoResultDto,
    @Req() req: AdminRequest,
  ) {
    return this.service.simulateTransfer(id, body.result, req.adminSession.user.id);
  }
}

@ApiTags("DoggyPay Demo - solo simulación")
@Controller("mock-payment-provider")
@UseGuards(PaymentPublicRateGuard)
export class MockPaymentController {
  constructor(
    private readonly provider: PaymentProvider,
    private readonly processor: PaymentEventProcessor,
  ) {}
  @Get("checkout")
  describe(@Headers("x-doggypay-token") token: string) {
    return this.provider.describeCheckout(token ?? "");
  }
  @Post("checkout/result")
  @HttpCode(200)
  async result(
    @Headers("x-doggypay-token") token: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) body: DemoResultDto,
  ) {
    const event = await this.provider.resolveCheckout(token ?? "", body.result);
    await this.processor.process(event);
    return {
      status:
        event.type === "PAYMENT_SUCCEEDED"
          ? "PAID"
          : event.type === "PAYMENT_FAILED"
            ? "FAILED"
            : "CANCELLED",
    };
  }
}
