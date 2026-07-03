import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

/**
 * Endpoints bajo /orders.
 *
 * Nota de orden de rutas: 'status/healthcheck' se declara ANTES de ':id' para
 * que NestJS no interprete "status" como un id de pedido.
 */
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * Health check del ALB (GET /orders/status/healthcheck). Devuelve 200.
   * Si esto diera 5xx, el ALB sacaría la tarea de rotación.
   */
  @Get('status/healthcheck')
  healthcheck() {
    return { status: 'ok' };
  }

  /** POST /orders → crea el pedido, calcula el total y emite order.created. */
  @Post()
  create(@Body() dto: CreateOrderDto) {
    return this.ordersService.createOrder(dto);
  }

  /** GET /orders/:id → el frontend hace polling de este endpoint cada 2s. */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const pedido = await this.ordersService.findOrder(id);
    if (!pedido) {
      throw new NotFoundException(`Pedido ${id} no encontrado`);
    }
    return pedido;
  }

  /**
   * DELETE /orders/:id → cancela el pedido.
   * Solo funciona si el estado es 'pending'; si no, el service lanza 409 Conflict.
   * (El frontend solo muestra el botón de cancelar cuando el estado es 'pending'.)
   */
  @Delete(':id')
  async cancel(@Param('id') id: string) {
    await this.ordersService.cancelOrder(id);
    return { status: 'cancelled', pedidoId: id };
  }
}
