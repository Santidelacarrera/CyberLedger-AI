import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ActionsService } from './actions.service';

@Controller('actions')
export class ActionsController {
  constructor(private readonly svc: ActionsService) {}
  @Get() list() { return this.svc.list(); }
  @Post() create(@Body() proposal: Record<string, unknown>) { return this.svc.create(proposal); }
  @Post(':id/approve') approve(@Param('id') id: string, @Headers('x-user') user = 'unknown') { return this.svc.approve(id, user); }
  @Post(':id/reject') reject(@Param('id') id: string) { return this.svc.reject(id); }
}
