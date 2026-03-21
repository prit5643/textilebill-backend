import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  private readonly technicalMessagePattern =
    /\b(database|prisma|sql|postgres|mysql|sqlite|mongodb|redis|foreign key|constraint|stack trace|sequelize|exception|orm|p\d{4}|econn|enotfound|etimedout)\b/i;

  private getDefaultMessageForStatus(status: number): string {
    if (
      status === HttpStatus.BAD_REQUEST ||
      status === HttpStatus.UNPROCESSABLE_ENTITY
    ) {
      return 'Please check your details and try again.';
    }
    if (status === HttpStatus.UNAUTHORIZED) {
      return 'Your session has expired. Please sign in again.';
    }
    if (status === HttpStatus.FORBIDDEN) {
      return 'You do not have permission to perform this action.';
    }
    if (status === HttpStatus.NOT_FOUND) {
      return 'The requested information was not found.';
    }
    if (status === HttpStatus.CONFLICT) {
      return 'This request could not be completed right now. Please try again.';
    }
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return 'Too many requests. Please wait and try again.';
    }
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      return 'Our service is temporarily unavailable. Please try again shortly.';
    }
    return 'Something went wrong. Please try again.';
  }

  private sanitizeUserMessage(message: string, status: number): string {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      return this.getDefaultMessageForStatus(status);
    }

    if (this.technicalMessagePattern.test(normalizedMessage)) {
      return this.getDefaultMessageForStatus(status);
    }

    return normalizedMessage;
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as any;
        message = resp.message || message;
        errors = resp.errors || null;

        // Handle class-validator errors
        if (Array.isArray(resp.message)) {
          errors = resp.message;
          message = this.getDefaultMessageForStatus(status);
        }
      }

      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(
          `HTTP ${status} on ${request.method} ${request.url}: ${
            typeof message === 'string' ? message : 'Internal server error'
          }`,
          exception.stack,
        );
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Log full Prisma error details for debugging
      this.logger.error(
        `Prisma Error [${exception.code}] on ${request.method} ${request.url}\n` +
          `  Message : ${exception.message}\n` +
          `  Meta    : ${JSON.stringify(exception.meta)}`,
        exception.stack,
      );
      // Map common Prisma errors to meaningful HTTP responses
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = 'A record with these details already exists.';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'The requested information was not found.';
      } else if (exception.code === 'P2003') {
        status = HttpStatus.BAD_REQUEST;
        message = 'This request could not be completed due to related data.';
      } else {
        message = this.getDefaultMessageForStatus(
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      this.logger.error(
        `Prisma Validation Error on ${request.method} ${request.url}:\n${exception.message}`,
      );
      status = HttpStatus.BAD_REQUEST;
      message = this.getDefaultMessageForStatus(HttpStatus.BAD_REQUEST);
    } else if (exception instanceof Error) {
      message = this.getDefaultMessageForStatus(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}: ${exception.message}`,
        exception.stack,
      );
    }

    if (typeof message === 'string') {
      message = this.sanitizeUserMessage(message, status);
    }

    const errorResponse = {
      statusCode: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId: request.headers['x-request-id'] || null,
    };

    response.status(status).json(errorResponse);
  }
}
