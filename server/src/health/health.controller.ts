import { Controller, Get, NotImplementedException } from '@nestjs/common';

@Controller('healthz')
export class HealthController {
  @Get()
  check(): { status: string } {
    throw new NotImplementedException();
  }
}
