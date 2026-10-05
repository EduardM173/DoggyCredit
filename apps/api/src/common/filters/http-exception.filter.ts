import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null;
    const message =
      typeof exceptionResponse === "string"
        ? exceptionResponse
        : ((exceptionResponse as { message?: string | string[] } | null)?.message ?? "Internal server error");

    if (!(exception instanceof HttpException)) {
      this.logger.error("Unhandled request failure");
    }

    const retryAfterSeconds = (exceptionResponse as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
    if (status === 429 && typeof retryAfterSeconds === "number")
      response.setHeader("Retry-After", String(retryAfterSeconds));

    response.status(status).json({
      statusCode: status,
      message,
      path: request.path,
      ...(status === 429 && typeof retryAfterSeconds === "number" ? { retryAfterSeconds } : {}),
      timestamp: new Date().toISOString(),
    });
  }
}
