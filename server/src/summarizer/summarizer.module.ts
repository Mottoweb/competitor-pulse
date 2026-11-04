import { Module } from '@nestjs/common';
import { SummaryQueries } from './summary-queries';

@Module({
  providers: [SummaryQueries],
  exports: [SummaryQueries],
})
export class SummarizerModule {}
