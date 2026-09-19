import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError } from '../contract/api.types';

/** Every non-2xx response body is an ApiError (api.types.ts). */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = toApiError(exception);
    if (body.statusCode >= 500 && !(exception instanceof HttpException)) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    res.status(body.statusCode).json(body);
  }
}

export function toApiError(exception: unknown): ApiError {
  if (!(exception instanceof HttpException)) {
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error', error: 'Internal Server Error' };
  }
  const statusCode = exception.getStatus();
  const response = exception.getResponse();
  if (typeof response === 'string') return { statusCode, message: response };
  const { message, error } = response as { message?: unknown; error?: unknown };
  const out: ApiError = {
    statusCode,
    message: typeof message === 'string' || isStringArray(message) ? message : exception.message,
  };
  if (typeof error === 'string') out.error = error;
  return out;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
