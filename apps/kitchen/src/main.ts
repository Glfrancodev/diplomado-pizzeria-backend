import 'dotenv/config'; // carga .env en local (en ECS no hay .env: no hace nada)
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { KitchenModule } from './kitchen.module';
import { DEFAULT_NATS_URL } from '@app/contracts';

/**
 * kitchen es un WORKER de NATS puro: NO abre HTTP, no escucha puertos.
 * Se conecta al broker y reacciona a eventos (order.created) y mensajes
 * (products.*, ingredients.*). Por eso usamos createMicroservice (no create).
 */
async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    KitchenModule,
    {
      transport: Transport.NATS,
      options: {
        servers: [process.env.NATS_URL ?? DEFAULT_NATS_URL],
      },
    },
  );

  await app.listen();
  Logger.log('kitchen escuchando eventos y mensajes NATS', 'Bootstrap');
}

bootstrap();
