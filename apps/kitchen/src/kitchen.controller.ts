import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  PRODUCTS_LIST,
  PRODUCTS_GET,
  INGREDIENTS_LIST,
  PRODUCTS_CREATE,
  INGREDIENTS_CREATE,
  ORDER_CREATED,
  ProductsListResponse,
  ProductsGetRequest,
  ProductsGetResponse,
  IngredientsListResponse,
  ProductsCreateRequest,
  IngredientsCreateRequest,
  OrderCreatedEvent,
} from '@app/contracts';
import { KitchenService } from './kitchen.service';

/**
 * Puerta de entrada NATS de kitchen.
 *
 * Sub-paso 4a: los @MessagePattern (request/response) con orders. Cada uno
 * recibe el payload, delega en el service y devuelve la respuesta (NATS la
 * manda de vuelta a quien preguntó).
 *
 * Falta (sub-paso 4b): @EventPattern(ORDER_CREATED) con la validación de stock.
 */
@Controller()
export class KitchenController {
  constructor(private readonly kitchenService: KitchenService) {}

  @MessagePattern(PRODUCTS_LIST)
  listProductos(): Promise<ProductsListResponse> {
    return this.kitchenService.listProductos();
  }

  @MessagePattern(PRODUCTS_GET)
  getProducto(
    @Payload() payload: ProductsGetRequest,
  ): Promise<ProductsGetResponse> {
    return this.kitchenService.getProducto(payload.productoId);
  }

  @MessagePattern(INGREDIENTS_LIST)
  listIngredientes(): Promise<IngredientsListResponse> {
    return this.kitchenService.listIngredientes();
  }

  @MessagePattern(PRODUCTS_CREATE)
  createProducto(@Payload() payload: ProductsCreateRequest) {
    return this.kitchenService.createProducto(payload);
  }

  @MessagePattern(INGREDIENTS_CREATE)
  createIngrediente(@Payload() payload: IngredientsCreateRequest) {
    return this.kitchenService.createIngrediente(payload);
  }

  // Evento (fire-and-forget): orders emitió order.created. kitchen valida el
  // stock y responde con order.preparing → order.ready / order.rejected.
  @EventPattern(ORDER_CREATED)
  onOrderCreated(@Payload() event: OrderCreatedEvent): Promise<void> {
    return this.kitchenService.handleOrderCreated(event);
  }
}
