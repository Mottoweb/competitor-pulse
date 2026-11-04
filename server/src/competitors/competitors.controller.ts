import type {
  Competitor as CompetitorContract,
  Snapshot as SnapshotContract,
} from '@competitor-pulse/shared';
import {
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Post,
} from '@nestjs/common';

@Controller('api/competitors')
export class CompetitorsController {
  @Get()
  list(): CompetitorContract[] {
    throw new NotImplementedException();
  }

  @Post()
  add(): CompetitorContract {
    throw new NotImplementedException();
  }

  @Delete(':id')
  remove(): void {
    throw new NotImplementedException();
  }

  @Get(':id/snapshots')
  snapshots(): SnapshotContract[] {
    throw new NotImplementedException();
  }
}
