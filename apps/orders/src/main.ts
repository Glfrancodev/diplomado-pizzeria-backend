import 'dotenv/config'; // carga .env en local (en ECS no hay .env: no hace nada)
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { OrdersModule } from './orders.module';
import { DEFAULT_NATS_URL } from '@app/contracts';

/**
 * orders es una app HÍBRIDA:
 *   - servidor HTTP (la única puerta del frontend, detrás del ALB), y
 *   - microservicio NATS (para ESCUCHAR los eventos order.* y persistir estados).
 *
 * Por eso, además de listen(port), conectamos un microservicio NATS y lo
 * arrancamos con startAllMicroservices().
 */
async function bootstrap() {
  const app = await NestFactory.create(OrdersModule);

  // CORS: el frontend (React) corre en otro origen y necesita poder llamar a la API.
  app.enableCors();

  // Escucha de eventos NATS (los @EventPattern de orders, que vienen en 6b).
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.NATS,
    options: { servers: [process.env.NATS_URL ?? DEFAULT_NATS_URL] },
  });
  await app.startAllMicroservices();

  const port = Number(process.env.ORDERS_HTTP_PORT ?? 3000);
  await app.listen(port);
  Logger.log(`orders HTTP escuchando en http://localhost:${port}`, 'Bootstrap');
}

bootstrap();
