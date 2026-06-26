import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ProductsCreateRequest,
  IngredientsCreateRequest,
  RepartidoresCreateRequest,
} from '@app/contracts';
import { OrdersService } from './orders.service';

/**
 * Endpoints "gateway": todo lo que el frontend pide sobre comida o repartidores
 * pasa por orders, que lo reenvía por NATS a kitchen/delivery (sus dueños).
 * orders NO toca esas tablas.
 *
 *   GET  /products        → kitchen products.list
 *   GET  /products/:id     → kitchen products.get
 *   GET  /ingredients      → kitchen ingredients.list
 *   POST /products         → kitchen products.create
 *   POST /ingredients      → kitchen ingredients.create
 *   POST /repartidores     → delivery repartidores.create
 *   GET  /health           → liveness simple (200)
 */
@Controller()
export class GatewayController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('products')
  listProducts() {
    return this.ordersService.listProducts();
  }

  @Get('products/:id')
  getProduct(@Param('id') id: string) {
    return this.ordersService.getProduct(id);
  }

  @Get('ingredients')
  listIngredients() {
    return this.ordersService.listIngredients();
  }

  @Post('products')
  createProduct(@Body() body: ProductsCreateRequest) {
    return this.ordersService.createProduct(body);
  }

  @Post('ingredients')
  createIngredient(@Body() body: IngredientsCreateRequest) {
    return this.ordersService.createIngredient(body);
  }

  @Post('repartidores')
  createRepartidor(@Body() body: RepartidoresCreateRequest) {
    return this.ordersService.createRepartidor(body);
  }
}
