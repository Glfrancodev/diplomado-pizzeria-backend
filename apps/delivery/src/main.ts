import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DeliveryModule } from './delivery.module';
import { DEFAULT_NATS_URL } from '@app/contracts';

/**
 * delivery es un WORKER de NATS puro: NO abre HTTP, no escucha puertos.
 * Escucha order.ready, asigna un repartidor disponible y emite order.delivered.
 */
async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    DeliveryModule,
    {
      transport: Transport.NATS,
      options: {
        servers: [process.env.NATS_URL ?? DEFAULT_NATS_URL],
      },
    },
  );

  await app.listen();
  Logger.log('delivery escuchando eventos y mensajes NATS', 'Bootstrap');
}

bootstrap();
