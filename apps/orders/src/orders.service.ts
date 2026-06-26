import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  Pedido,
  LineaPedido,
  EstadoPedido,
  NATS_SERVICE,
  PRODUCTS_LIST,
  PRODUCTS_GET,
  INGREDIENTS_LIST,
  PRODUCTS_CREATE,
  INGREDIENTS_CREATE,
  REPARTIDORES_CREATE,
  ORDER_CREATED,
  OrderCreatedEvent,
  ProductsListResponse,
  ProductsGetRequest,
  ProductsGetResponse,
  IngredientsListResponse,
  ProductsCreateRequest,
  ProductsCreateResponse,
  IngredientsCreateRequest,
  IngredientsCreateResponse,
  RepartidoresCreateRequest,
  RepartidoresCreateResponse,
} from '@app/contracts';
import { DYNAMO } from './dynamo/dynamo.provider';
import { CreateOrderDto } from './dto/create-order.dto';

/** Cuánto suma cada ingrediente extra al precio de una pizza (constante de negocio). */
const PRECIO_EXTRA = 5;

/**
 * Lógica de orders. Es la ÚNICA puerta HTTP (patrón gateway) y dueña de la tabla
 * pizzeria-pedidos.
 *
 * Dos roles:
 *  - PROXY por NATS: para datos de comida/repartidores NO toca tablas ajenas;
 *    le pregunta a kitchen/delivery con send() (request/response).
 *  - DUEÑA de pedidos: lee/escribe pizzeria-pedidos en DynamoDB.
 *
 * Sub-paso 6a: los proxies + la lectura de un pedido (GET /orders/:id).
 * El POST /orders (crear + calcular total + emitir) y los @EventPattern que
 * persisten los estados van en el sub-paso 6b.
 */
@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);

  private readonly tablaPedidos = process.env.TABLE_PEDIDOS;

  constructor(
    @Inject(NATS_SERVICE) private readonly nats: ClientProxy,
    @Inject(DYNAMO) private readonly dynamo: DynamoDBDocumentClient,
  ) {}

  async onModuleInit(): Promise<void> {
    // Abre la conexión al broker al arrancar (si no, se conecta en el 1er send).
    await this.nats.connect();
    this.logger.log('Conectado al broker NATS');
  }

  // ─── PROXY a kitchen (request/response por NATS) ─────────────────────────────

  /** GET /products → products.list (kitchen). */
  listProducts(): Promise<ProductsListResponse> {
    return firstValueFrom(this.nats.send(PRODUCTS_LIST, {}));
  }

  /** GET /products/:id → products.get (kitchen). */
  getProduct(productoId: string): Promise<ProductsGetResponse> {
    const req: ProductsGetRequest = { productoId };
    return firstValueFrom(this.nats.send(PRODUCTS_GET, req));
  }

  /** GET /ingredients → ingredients.list (kitchen). */
  listIngredients(): Promise<IngredientsListResponse> {
    return firstValueFrom(this.nats.send(INGREDIENTS_LIST, {}));
  }

  /** POST /products → products.create (kitchen, que es quien escribe). */
  createProduct(req: ProductsCreateRequest): Promise<ProductsCreateResponse> {
    return firstValueFrom(this.nats.send(PRODUCTS_CREATE, req));
  }

  /** POST /ingredients → ingredients.create (kitchen). */
  createIngredient(
    req: IngredientsCreateRequest,
  ): Promise<IngredientsCreateResponse> {
    return firstValueFrom(this.nats.send(INGREDIENTS_CREATE, req));
  }

  // ─── PROXY a delivery ────────────────────────────────────────────────────────

  /** POST /repartidores → repartidores.create (delivery, que es quien escribe). */
  createRepartidor(
    req: RepartidoresCreateRequest,
  ): Promise<RepartidoresCreateResponse> {
    return firstValueFrom(this.nats.send(REPARTIDORES_CREATE, req));
  }

  // ─── TABLA PROPIA: pizzeria-pedidos ──────────────────────────────────────────

  /** GET /orders/:id → lee el pedido de su propia tabla (para el polling). */
  async findOrder(pedidoId: string): Promise<Pedido | undefined> {
    const res = await this.dynamo.send(
      new GetCommand({
        TableName: this.tablaPedidos,
        Key: { pedidoId },
      }),
    );
    return res.Item as Pedido | undefined;
  }

  /**
   * POST /orders → crear un pedido.
   *   1. Por cada línea pide el precioBase a kitchen (NATS) y calcula el subtotal
   *      con la fórmula: (precioBase + nº_extras × PRECIO_EXTRA) × cantidad.
   *      (El total lo calcula orders: nunca se confía en precios del frontend.)
   *   2. Guarda el pedido en estado "pending" en pizzeria-pedidos.
   *   3. Emite order.created → arranca la cadena (kitchen valida, etc.).
   */
  async createOrder(dto: CreateOrderDto): Promise<Pedido> {
    const pedidoId = randomUUID();
    const now = new Date().toISOString();

    const lineas: LineaPedido[] = [];
    for (const linea of dto.lineas) {
      // products.get a kitchen: trae el producto (con precioBase). Si no existe,
      // kitchen responde con error y este send rechaza la promesa.
      const { producto } = await this.getProduct(linea.productoId);
      const subtotal =
        (producto.precioBase + linea.extras.length * PRECIO_EXTRA) *
        linea.cantidad;
      lineas.push({
        productoId: linea.productoId,
        cantidad: linea.cantidad,
        extras: linea.extras,
        subtotal,
      });
    }
    const total = lineas.reduce((acc, l) => acc + l.subtotal, 0);

    const pedido: Pedido = {
      pedidoId,
      cliente: dto.cliente,
      direccion: dto.direccion,
      estado: 'pending',
      lineas,
      total,
      repartidor: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.dynamo.send(
      new PutCommand({ TableName: this.tablaPedidos, Item: pedido }),
    );
    this.logger.log(`Pedido creado ${pedidoId} (total ${total})`);

    // order.created lleva solo lo que kitchen necesita para validar el stock.
    const event: OrderCreatedEvent = {
      pedidoId,
      lineas: lineas.map((l) => ({
        productoId: l.productoId,
        cantidad: l.cantidad,
        extras: l.extras,
      })),
    };
    this.nats.emit(ORDER_CREATED, event);

    return pedido;
  }

  // ─── PERSISTENCIA DE ESTADOS (orders = único escritor de pedidos) ─────────────

  /** Actualiza el estado de un pedido (preparing / searching_delivery / ready / rejected). */
  async persistirEstado(
    pedidoId: string,
    estado: EstadoPedido,
  ): Promise<void> {
    await this.dynamo.send(
      new UpdateCommand({
        TableName: this.tablaPedidos,
        Key: { pedidoId },
        UpdateExpression: 'SET estado = :e, updatedAt = :u',
        ExpressionAttributeValues: {
          ':e': estado,
          ':u': new Date().toISOString(),
        },
      }),
    );
    this.logger.log(`Pedido ${pedidoId} → ${estado}`);
  }

  /** Actualiza estado + repartidor (para on_the_way y delivered). */
  async persistirEstadoYRepartidor(
    pedidoId: string,
    estado: EstadoPedido,
    repartidor: string,
  ): Promise<void> {
    await this.dynamo.send(
      new UpdateCommand({
        TableName: this.tablaPedidos,
        Key: { pedidoId },
        UpdateExpression:
          'SET estado = :e, repartidor = :r, updatedAt = :u',
        ExpressionAttributeValues: {
          ':e': estado,
          ':r': repartidor,
          ':u': new Date().toISOString(),
        },
      }),
    );
    this.logger.log(`Pedido ${pedidoId} → ${estado} (repartidor ${repartidor})`);
  }
}
