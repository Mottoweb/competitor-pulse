import 'reflect-metadata';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe('GET /healthz with Postgres unreachable', () => {
  let app: INestApplication;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: DataSource,
          useValue: {
            query: () => Promise.reject(new Error('connect ECONNREFUSED')),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 503 and does not leak the error', async () => {
    const response = await request(await app.getUrl())
      .get('/healthz')
      .expect(503);

    expect(response.body).toEqual({ status: 'unavailable' });
    expect(response.text).not.toContain('ECONNREFUSED');
  });
});
