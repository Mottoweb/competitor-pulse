import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { parseDatabaseConfig } from '../config';
import { buildDataSourceOptions } from './data-source-options';

// Entry point for the TypeORM CLI, which needs one exported DataSource.
export default new DataSource(
  buildDataSourceOptions(parseDatabaseConfig(process.env)),
);
