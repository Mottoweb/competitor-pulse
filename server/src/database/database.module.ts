import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { parseDatabaseConfig } from '../config';
import { buildDataSourceOptions } from './data-source-options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => buildDataSourceOptions(parseDatabaseConfig(process.env)),
    }),
  ],
})
export class DatabaseModule {}
