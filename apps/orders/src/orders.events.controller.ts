import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  ORDER_VERIFYING,
  ORDER_PREPARING,
  ORDER_SEARCHING_DELIVERY,
  ORDER_READY,
  ORDER_REJECTED,
  ORDER_ON_THE_WAY,
  ORDER_DELIVERED,
  OrderVerifyingEvent,
  OrderPreparingEvent,
  OrderSearchingDeliveryEvent,
  OrderReadyEvent,
  OrderRejectedEvent,
  OrderOnTheWayEvent,
  OrderDeliveredEvent,
} from '@app/contracts';
import { OrdersService } from './orders.service';

/**
 * orders escucha por NATS la cadena de estados que emiten kitchen y delivery, y
 * los persiste en pizzeria-pedidos. orders es el ÚNICO escritor de esa tabla:
 * kitchen/delivery NO la tocan, solo avisan por evento.
 *
 * Máquina de estados:
 *   pending → preparing → ready → (searching_delivery) → on_the_way → delivered
 *                       ↘ rejected
 */
@Controller()
export class OrdersEventsController {
  constructor(private readonly ordersService: OrdersService) {}

  @EventPattern(ORDER_VERIFYING)
  onVerifying(@Payload() e: OrderVerifyingEvent): Promise<void> {
    return this.ordersService.persistirEstado(e.pedidoId, 'verifying');
  }

  @EventPattern(ORDER_PREPARING)
  onPreparing(@Payload() e: OrderPreparingEvent): Promise<void> {
    return this.ordersService.persistirEstado(e.pedidoId, 'preparing');
  }

  @EventPattern(ORDER_READY)
  onReady(@Payload() e: OrderReadyEvent): Promise<void> {
    return this.ordersService.persistirEstado(e.pedidoId, 'ready');
  }

  @EventPattern(ORDER_REJECTED)
  onRejected(@Payload() e: OrderRejectedEvent): Promise<void> {
    return this.ordersService.persistirEstado(e.pedidoId, 'rejected');
  }

  @EventPattern(ORDER_SEARCHING_DELIVERY)
  onSearching(@Payload() e: OrderSearchingDeliveryEvent): Promise<void> {
    return this.ordersService.persistirEstado(e.pedidoId, 'searching_delivery');
  }

  // on_the_way y delivered traen el repartidor → lo guardamos en el pedido.
  @EventPattern(ORDER_ON_THE_WAY)
  onOnTheWay(@Payload() e: OrderOnTheWayEvent): Promise<void> {
    return this.ordersService.persistirEstadoYRepartidor(
      e.pedidoId,
      'on_the_way',
      e.repartidor,
    );
  }

  @EventPattern(ORDER_DELIVERED)
  onDelivered(@Payload() e: OrderDeliveredEvent): Promise<void> {
    return this.ordersService.persistirEstadoYRepartidor(
      e.pedidoId,
      'delivered',
      e.repartidor,
    );
  }
}
