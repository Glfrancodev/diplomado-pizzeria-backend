import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { dynamoProvider } from './dynamo/dynamo.provider';
import { NATS_SERVICE, DEFAULT_NATS_URL } from '@app/contracts';

@Module({
  imports: [
    // delivery escucha NATS (order.ready) pero además EMITE order.delivered:
    // registra un cliente NATS bajo el token NATS_SERVICE para hacer emit().
    ClientsModule.register([
      {
        name: NATS_SERVICE,
        transport: Transport.NATS,
        options: { servers: [process.env.NATS_URL ?? DEFAULT_NATS_URL] },
      },
    ]),
  ],
  controllers: [DeliveryController],
  providers: [DeliveryService, dynamoProvider],
})
export class DeliveryModule {}
