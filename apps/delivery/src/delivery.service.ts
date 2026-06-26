import { Injectable, Logger } from '@nestjs/common';

/**
 * Lógica de delivery. Dueña de la tabla pizzeria-repartidores (DynamoDB).
 *
 * ANDAMIAJE: por ahora solo loguea. En el paso 5 agregamos:
 *   - cliente DynamoDB (sin credenciales: IAM role de Fargate)
 *   - alta de repartidores
 *   - asignación de un repartidor disponible al recibir order.ready
 *   - "simulación" del viaje (sleep) + emisión de order.delivered
 *   delivery NO escribe en pedidos: emite el evento y orders persiste el estado.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);
}
