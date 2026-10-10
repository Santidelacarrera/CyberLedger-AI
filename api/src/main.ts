import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { JsonLogger } from './logger';

async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new JsonLogger(), bodyParser: false,
    cors: { origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' },
  });
  app.useBodyParser('json', { limit: process.env.BODY_LIMIT ?? '5mb' });
  app.disable('x-powered-by');
  app.use((_req: any, res: any, next: any) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); next(); });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}
main();
