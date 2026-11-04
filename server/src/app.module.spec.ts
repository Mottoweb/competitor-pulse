import 'reflect-metadata';
import { SUMMARY_STATUSES } from '@competitor-pulse/shared';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('test setup', () => {
  it('runs TypeScript, boots the Nest module and loads the shared workspace at runtime', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef.get(AppModule)).toBeInstanceOf(AppModule);
    expect(SUMMARY_STATUSES).toEqual(['none', 'pending', 'done', 'failed']);
  });
});
