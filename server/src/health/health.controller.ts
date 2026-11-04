import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiProperty,
  ApiSchema,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DataSource } from 'typeorm';

export const HEALTH_QUERY_TIMEOUT_MS = Symbol('HEALTH_QUERY_TIMEOUT_MS');

@ApiSchema({ name: 'Health' })
class HealthDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
}

@ApiSchema({ name: 'HealthUnavailable' })
class HealthUnavailableDto {
  @ApiProperty({ enum: ['unavailable'] })
  status!: 'unavailable';
}

@ApiTags('health')
@Controller('healthz')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly dataSource: DataSource) {}

  @Get()
  @ApiOkResponse({ type: HealthDto })
  @ApiServiceUnavailableResponse({ type: HealthUnavailableDto })
  async check(): Promise<HealthDto> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch (error) {
      this.logger.warn(`Postgres is unreachable: ${String(error)}`);
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
    return { status: 'ok' };
  }
}
