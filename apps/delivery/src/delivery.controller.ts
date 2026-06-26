import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  ORDER_READY,
  REPARTIDORES_CREATE,
  OrderReadyEvent,
  RepartidoresCreateRequest,
} from '@app/contracts';
import { DeliveryService } from './delivery.service';

/**
 * Puerta de entrada NATS de delivery.
 *   @EventPattern(ORDER_READY)           → asignar repartidor + simular + entregar
 *   @MessagePattern(REPARTIDORES_CREATE) → alta de repartidor (request/response)
 */
@Controller()
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @EventPattern(ORDER_READY)
  onOrderReady(@Payload() event: OrderReadyEvent): Promise<void> {
    return this.deliveryService.handleOrderReady(event);
  }

  @MessagePattern(REPARTIDORES_CREATE)
  createRepartidor(@Payload() payload: RepartidoresCreateRequest) {
    return this.deliveryService.createRepartidor(payload);
  }
}
