import { join } from 'node:path';
import type { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';
import { Competitor } from '../competitors/competitor.entity';
import type { DatabaseConfig } from '../config';
import { Snapshot } from '../poller/snapshot.entity';
import { SourceCursor } from '../source/source-cursor.entity';

export function buildDataSourceOptions(
  config: DatabaseConfig,
): PostgresDataSourceOptions {
  return {
    type: 'postgres',
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    database: config.database,
    entities: [Competitor, Snapshot, SourceCursor],
    // src/database and dist/src/database both sit two levels below the folder
    // that holds migrations/.
    migrations: [join(__dirname, '../../migrations/*.{ts,js}')],
    synchronize: false,
    logging: config.logQueries,
  };
}
