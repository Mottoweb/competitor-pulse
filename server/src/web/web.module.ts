import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function resolveWebRoot(env: NodeJS.ProcessEnv): string {
  if (env.WEB_DIST_DIR !== undefined) {
    return env.WEB_DIST_DIR;
  }
  // The compiled file sits one level deeper than its source.
  const fromSource = join(__dirname, '../../../web/dist');
  const fromDist = join(__dirname, '../../../../web/dist');
  return existsSync(fromDist) ? fromDist : fromSource;
}

@Module({
  imports: [
    // A factory, so the path is read after main.ts has loaded .env.
    ServeStaticModule.forRootAsync({
      useFactory: () => [
        {
          rootPath: resolveWebRoot(process.env),
          // Without this, an unknown API path would answer 200 with the app's HTML.
          exclude: ['/api{/*path}', '/healthz'],
        },
      ],
    }),
  ],
})
export class WebModule {}
