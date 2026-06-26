import { Controller } from '@nestjs/common';
import { DeliveryService } from './delivery.service';

/**
 * Puerta de entrada NATS de delivery.
 *
 * ANDAMIAJE: vacío por ahora. En el paso 5 le agregamos:
 *   @EventPattern(ORDER_READY)            → asignar repartidor, simular viaje,
 *                                           emitir order.delivered
 *   @MessagePattern(REPARTIDORES_CREATE)  → alta de repartidor
 */
@Controller()
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}
}
