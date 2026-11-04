import type {
  Competitor as CompetitorContract,
  Snapshot as SnapshotContract,
} from '@competitor-pulse/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  addCompetitorSchema,
  CompetitorsService,
  snapshotLimitSchema,
} from './competitors.service';
import { ZodValidationPipe } from './zod-validation.pipe';

@Controller('api/competitors')
export class CompetitorsController {
  constructor(private readonly competitors: CompetitorsService) {}

  @Get()
  list(): Promise<CompetitorContract[]> {
    return this.competitors.list();
  }

  @Post()
  add(
    @Body(new ZodValidationPipe(addCompetitorSchema))
    body: z.infer<typeof addCompetitorSchema>,
  ): Promise<CompetitorContract> {
    return this.competitors.add(body.id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.competitors.remove(id);
  }

  @Get(':id/snapshots')
  snapshots(
    @Param('id') id: string,
    @Query('limit', new ZodValidationPipe(snapshotLimitSchema))
    limit: number | undefined,
  ): Promise<SnapshotContract[]> {
    return this.competitors.listSnapshots(id, limit);
  }
}
