import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

NestFactory.create(AppModule, { cors: { origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' } })
  .then((app) => app.listen(Number(process.env.PORT ?? 3000)));
