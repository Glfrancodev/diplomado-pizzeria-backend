import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';
import { dynamoProvider } from './dynamo/dynamo.provider';
import { NATS_SERVICE, DEFAULT_NATS_URL } from '@app/contracts';

@Module({
  imports: [
    // kitchen escucha NATS (es microservicio), pero además necesita EMITIR
    // eventos (order.preparing/ready/rejected). Para eso registra un cliente
    // NATS bajo el token NATS_SERVICE, que el service inyecta para hacer emit().
    ClientsModule.register([
      {
        name: NATS_SERVICE,
        transport: Transport.NATS,
        options: { servers: [process.env.NATS_URL ?? DEFAULT_NATS_URL] },
      },
    ]),
  ],
  controllers: [KitchenController],
  providers: [KitchenService, dynamoProvider],
})
export class KitchenModule {}
