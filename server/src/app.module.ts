import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { PollerModule } from './poller/poller.module';
import { SummarizerModule } from './summarizer/summarizer.module';

@Module({
  imports: [DatabaseModule, PollerModule, SummarizerModule],
})
export class AppModule {}
