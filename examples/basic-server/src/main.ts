import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.enableCors();

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Claude Plugin API')
    .setDescription('REST API for Claude Code plugins')
    .setVersion('1.0')
    .addTag('plugins', 'Plugin discovery and execution')
    .addTag('streaming', 'SSE streaming endpoints')
    .addTag('files', 'File upload and management')
    .addBasicAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`Application running on http://localhost:${port}`);
  logger.log(`API docs available at http://localhost:${port}/api/docs`);
}
bootstrap();
