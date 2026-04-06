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

type PrismaLikeKnownError = {
  code: string;
  message: string;
  meta?: unknown;
  stack?: string;
};

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

  private asPrismaKnownRequestError(
    exception: unknown,
  ): PrismaLikeKnownError | null {
    if (!exception || typeof exception !== 'object') {
      return null;
    }

    const candidate = exception as {
      code?: unknown;
      message?: unknown;
      stack?: unknown;
      meta?: unknown;
    };

    if (
      typeof candidate.code !== 'string' ||
      !/^P\d{4}$/.test(candidate.code) ||
      typeof candidate.message !== 'string'
    ) {
      return null;
    }

    return {
      code: candidate.code,
      message: candidate.message,
      meta: candidate.meta,
      stack: typeof candidate.stack === 'string' ? candidate.stack : undefined,
    };
  }

  private isPrismaValidationError(exception: unknown): boolean {
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return true;
    }

    if (!exception || typeof exception !== 'object') {
      return false;
    }

    const name = (exception as { name?: unknown }).name;
    return name === 'PrismaClientValidationError';
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
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError ||
      this.asPrismaKnownRequestError(exception)
    ) {
      const prismaError =
        exception instanceof Prisma.PrismaClientKnownRequestError
          ? exception
          : this.asPrismaKnownRequestError(exception);

      if (!prismaError) {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        message = this.getDefaultMessageForStatus(status);
      } else {
      // Log full Prisma error details for debugging
      this.logger.error(
        `Prisma Error [${prismaError.code}] on ${request.method} ${request.url}\n` +
          `  Message : ${prismaError.message}\n` +
          `  Meta    : ${JSON.stringify(prismaError.meta)}`,
        prismaError.stack,
      );
      // Map common Prisma errors to meaningful HTTP responses
      if (prismaError.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = 'A record with these details already exists.';
      } else if (prismaError.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'The requested information was not found.';
      } else if (prismaError.code === 'P2003') {
        status = HttpStatus.BAD_REQUEST;
        message = 'This request could not be completed due to related data.';
      } else if (prismaError.code === 'P2000') {
        status = HttpStatus.BAD_REQUEST;
        message = 'One or more fields contain invalid values.';
      } else {
        message = this.getDefaultMessageForStatus(
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      }
    } else if (this.isPrismaValidationError(exception)) {
      const prismaValidationMessage =
        exception instanceof Error
          ? exception.message
          : 'Prisma validation error';
      this.logger.error(
        `Prisma Validation Error on ${request.method} ${request.url}:\n${prismaValidationMessage}`,
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
