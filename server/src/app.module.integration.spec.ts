import 'reflect-metadata';
import { SUMMARY_STATUSES } from '@competitor-pulse/shared';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { Snapshot } from './poller/snapshot.entity';
import {
  createMigratedTestDatabase,
  dropTestDatabase,
} from './testing/test-database';

// Booting AppModule connects to Postgres, so this moved here from the unit suite.
describe('test setup', () => {
  let dataSource: DataSource;
  const originalDatabase = process.env.POSTGRES_DB;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    dataSource = await createMigratedTestDatabase('app_module');
    process.env.POSTGRES_DB = String(dataSource.options.database);
  });

  afterAll(async () => {
    process.env.POSTGRES_DB = originalDatabase;
    await dropTestDatabase(dataSource);
  });

  it('runs TypeScript, boots the Nest module and loads the shared workspace at runtime', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef.get(AppModule)).toBeInstanceOf(AppModule);
    expect(SUMMARY_STATUSES).toEqual(['none', 'pending', 'done', 'failed']);

    await moduleRef.close();
  });

  it('polls due competitors at startup and finishes the check before closing', async () => {
    await dataSource.query(`INSERT INTO competitors (id) VALUES ('acme-crm')`);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    await app.init();
    await app.close();

    const rows = await dataSource.manager.find(Snapshot);
    expect(rows.map((row) => row.title)).toEqual(['Acme CRM']);
  });
});
