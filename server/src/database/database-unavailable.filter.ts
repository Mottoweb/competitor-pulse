import {
  Catch,
  ServiceUnavailableException,
  type ArgumentsHost,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { isDatabaseUnavailable } from './database-unavailable';

/** Answers 503 when Postgres can't be reached, so a client can tell it may retry. */
@Catch()
export class DatabaseUnavailableFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(
      isDatabaseUnavailable(exception)
        ? new ServiceUnavailableException(
            'The database is unavailable. Try again shortly.',
          )
        : exception,
      host,
    );
  }
}
