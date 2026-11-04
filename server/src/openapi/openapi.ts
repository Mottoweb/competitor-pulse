import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { join } from 'node:path';

/** The committed spec. Only meaningful when running from source. */
export const OPENAPI_SPEC_PATH = join(__dirname, '../../openapi.json');

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  void app;
  return { openapi: '3.0.0', info: { title: '', version: '' }, paths: {} };
}

export function setupSwagger(app: INestApplication): void {
  void app;
}

export function renderOpenApiSpec(): Promise<string> {
  return Promise.resolve('');
}
