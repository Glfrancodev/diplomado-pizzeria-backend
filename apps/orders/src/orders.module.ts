import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NATS_SERVICE, DEFAULT_NATS_URL } from '@app/contracts';
import { OrdersController } from './orders.controller';
import { GatewayController } from './gateway.controller';
import { OrdersEventsController } from './orders.events.controller';
import { OrdersService } from './orders.service';
import { dynamoProvider } from './dynamo/dynamo.provider';

@Module({
  imports: [
    // orders EMITE order.created y hace send() a kitchen/delivery: cliente NATS.
    ClientsModule.register([
      {
        name: NATS_SERVICE,
        transport: Transport.NATS,
        options: { servers: [process.env.NATS_URL ?? DEFAULT_NATS_URL] },
      },
    ]),
  ],
  controllers: [OrdersController, GatewayController, OrdersEventsController],
  providers: [OrdersService, dynamoProvider],
})
export class OrdersModule {}
