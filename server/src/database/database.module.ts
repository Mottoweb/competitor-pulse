import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { parseDatabaseConfig } from '../config';
import { buildDataSourceOptions } from './data-source-options';
import { DatabaseUnavailableFilter } from './database-unavailable.filter';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => buildDataSourceOptions(parseDatabaseConfig(process.env)),
    }),
  ],
  providers: [{ provide: APP_FILTER, useClass: DatabaseUnavailableFilter }],
})
export class DatabaseModule {}
