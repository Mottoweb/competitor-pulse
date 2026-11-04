import { Module } from '@nestjs/common';
import { CompetitorsController } from './competitors.controller';

@Module({
  controllers: [CompetitorsController],
})
export class CompetitorsModule {}
