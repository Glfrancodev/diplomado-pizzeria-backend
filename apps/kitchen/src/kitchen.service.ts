import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  Producto,
  Ingrediente,
  ProductsGetResponse,
  ProductsCreateRequest,
  IngredientsCreateRequest,
  OrderCreatedEvent,
  NATS_SERVICE,
  ORDER_VERIFYING,
  ORDER_PREPARING,
  ORDER_READY,
  ORDER_REJECTED,
  OrderVerifyingEvent,
  OrderPreparingEvent,
  OrderReadyEvent,
  OrderRejectedEvent,
} from '@app/contracts';
import { DYNAMO } from './dynamo/dynamo.provider';

/** Mínimo que debe verse un estado "instantáneo" antes de pasar al siguiente. */
const ESPERA_ESTADO = 4000;
/** Duración de la "preparación" simulada (estado preparing). */
const TIEMPO_PREPARACION = 10000;

/**
 * Lógica de kitchen. Dueña de las tablas pizzeria-productos y
 * pizzeria-ingredientes (DynamoDB).
 *
 * Sub-paso 4a: lecturas (list/get) y altas (create). El manejo de order.created
 * (validar stock + descontar + simular + emitir eventos) va en el sub-paso 4b.
 *
 * Los nombres de tabla NO se hardcodean: vienen por env var (los inyecta la infra).
 */
@Injectable()
export class KitchenService {
  private readonly logger = new Logger(KitchenService.name);

  private readonly tablaProductos = process.env.TABLE_PRODUCTOS;
  private readonly tablaIngredientes = process.env.TABLE_INGREDIENTES;

  constructor(
    @Inject(DYNAMO) private readonly dynamo: DynamoDBDocumentClient,
    @Inject(NATS_SERVICE) private readonly nats: ClientProxy,
  ) {}

  // ─── LECTURAS ──────────────────────────────────────────────────────────────

  /** products.list → escanea toda la tabla de productos (el menú completo). */
  async listProductos(): Promise<Producto[]> {
    const res = await this.dynamo.send(
      new ScanCommand({ TableName: this.tablaProductos }),
    );
    return (res.Items ?? []) as Producto[];
  }

  /** ingredients.list → escanea la tabla de ingredientes (los extras posibles). */
  async listIngredientes(): Promise<Ingrediente[]> {
    const res = await this.dynamo.send(
      new ScanCommand({ TableName: this.tablaIngredientes }),
    );
    return (res.Items ?? []) as Ingrediente[];
  }

  /**
   * products.get → trae un producto por su PK.
   *
   * Además devuelve un flag `disponible` (OPCIONAL e INFORMATIVO): indica si hay
   * stock para armar AL MENOS UNA unidad, recorriendo su receta y mirando el
   * stock de cada ingrediente. Sirve para que el frontend pueda pintar "Agotado"
   * en el menú; el front es libre de usarlo o ignorarlo.
   *
   * ⚠️ IMPORTANTE: este flag NO es la "validación clave" del enunciado.
   *   - `disponible` acá = ayuda visual para el menú (lectura informativa).
   *   - La validación que ACEPTA o RECHAZA un pedido vive en otro lado: en el
   *     handler de `order.created` (sub-paso 4b), donde kitchen valida la receta
   *     × cantidad + extras contra el stock y emite order.ready / order.rejected.
   * Son cosas distintas: este flag nunca decide si un pedido se acepta.
   *
   * Costo: calcular `disponible` lee los ingredientes de la receta en cada
   * llamada. Son lecturas baratas; si algún día molesta, se puede quitar sin
   * afectar la validación real del pedido.
   */
  async getProducto(productoId: string): Promise<ProductsGetResponse> {
    const producto = await this.buscarProducto(productoId);
    if (!producto) {
      throw new RpcException(`Producto ${productoId} no existe`);
    }

    const disponible = await this.hayStockParaUna(producto);
    return { producto, disponible };
  }

  // ─── ALTAS ─────────────────────────────────────────────────────────────────

  /** products.create → kitchen escribe el producto en SU tabla. */
  async createProducto(req: ProductsCreateRequest): Promise<Producto> {
    const producto: Producto = {
      productoId: req.productoId,
      nombre: req.nombre,
      precioBase: req.precioBase,
      receta: req.receta,
    };
    await this.dynamo.send(
      new PutCommand({ TableName: this.tablaProductos, Item: producto }),
    );
    this.logger.log(`Producto creado: ${producto.productoId}`);
    return producto;
  }

  /** ingredients.create → kitchen escribe el ingrediente en SU tabla. */
  async createIngrediente(
    req: IngredientsCreateRequest,
  ): Promise<Ingrediente> {
    const ingrediente: Ingrediente = {
      ingredienteId: req.ingredienteId,
      nombre: req.nombre,
      cantidadDisponible: req.cantidadDisponible,
    };
    await this.dynamo.send(
      new PutCommand({ TableName: this.tablaIngredientes, Item: ingrediente }),
    );
    this.logger.log(`Ingrediente creado: ${ingrediente.ingredienteId}`);
    return ingrediente;
  }

  // ─── VALIDACIÓN DEL PEDIDO (la "validación clave" del enunciado) ─────────────

  /**
   * order.created → kitchen valida el pedido contra el stock.
   *
   * Con pausas para que el frontend (polling cada 2s) vea cada estado:
   *   pending → (4s) → verifying → (4s) → preparing → (10s) → ready
   *                                     ↘ rejected
   *
   * Pasos:
   *   1. Espera un mínimo (deja ver "pending") y emite verifying.
   *   2. Calcula el consumo total: por cada línea expande la receta × cantidad,
   *      + 1 por cada extra (× cantidad), en un mapa { ingredienteId → cantidad }.
   *      Chequea existencia y stock; guarda el motivo si algo falla.
   *   3. Tras un mínimo (deja ver "verifying"): si hubo motivo → order.rejected.
   *   4. Si alcanza → order.preparing, descuenta stock, "simula" la preparación
   *      (~10s) y emite order.ready.
   */
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    const { pedidoId, lineas } = event;
    this.logger.log(`order.created recibido: ${pedidoId}`);

    // 1. Dejar ver "pending" un mínimo y pasar a "verifying".
    await this.sleep(ESPERA_ESTADO);
    this.emitirVerifying(pedidoId);

    // 2. Verificar: consumo total + existencia + stock (guardando el motivo).
    const consumo = new Map<string, number>();
    let motivo: string | undefined;
    for (const linea of lineas) {
      const producto = await this.buscarProducto(linea.productoId);
      if (!producto) {
        motivo = `Producto ${linea.productoId} no existe`;
        break;
      }
      // Receta base × cantidad de la línea.
      for (const item of producto.receta) {
        this.acumular(consumo, item.ingredienteId, item.cantidad * linea.cantidad);
      }
      // Cada extra suma 1 unidad de ese ingrediente, también × cantidad.
      for (const extraId of linea.extras) {
        this.acumular(consumo, extraId, linea.cantidad);
      }
    }
    if (!motivo) {
      for (const [ingredienteId, necesario] of consumo) {
        const ingrediente = await this.buscarIngrediente(ingredienteId);
        if (!ingrediente || ingrediente.cantidadDisponible < necesario) {
          motivo = `Sin stock de ${ingredienteId}`;
          break;
        }
      }
    }

    // 3. Dejar ver "verifying" un mínimo; si algo falló, rechazar.
    await this.sleep(ESPERA_ESTADO);
    if (motivo) {
      return this.rechazar(pedidoId, motivo);
    }

    // 4. Aceptado: preparing → descontar → simular (~10s) → ready.
    this.emitirPreparing(pedidoId);
    for (const [ingredienteId, necesario] of consumo) {
      await this.descontarStock(ingredienteId, necesario);
    }
    await this.sleep(TIEMPO_PREPARACION); // "simula" la preparación: no cocina nada real
    this.emitirReady(pedidoId);
    this.logger.log(`Pedido ${pedidoId} listo (order.ready)`);
  }

  // ─── HELPERS (privados) ──────────────────────────────────────────────────────

  /** Suma `cantidad` a la entrada `ingredienteId` del mapa de consumo. */
  private acumular(
    consumo: Map<string, number>,
    ingredienteId: string,
    cantidad: number,
  ): void {
    consumo.set(ingredienteId, (consumo.get(ingredienteId) ?? 0) + cantidad);
  }

  /** Descuenta stock de un ingrediente de forma atómica en DynamoDB. */
  private async descontarStock(
    ingredienteId: string,
    cantidad: number,
  ): Promise<void> {
    await this.dynamo.send(
      new UpdateCommand({
        TableName: this.tablaIngredientes,
        Key: { ingredienteId },
        // Resta en la propia base (atómico): evita leer-modificar-escribir.
        UpdateExpression:
          'SET cantidadDisponible = cantidadDisponible - :n',
        ExpressionAttributeValues: { ':n': cantidad },
      }),
    );
  }

  /** Emite order.rejected con el motivo (no descuenta nada). */
  private rechazar(pedidoId: string, reason: string): void {
    this.logger.warn(`Pedido ${pedidoId} rechazado: ${reason}`);
    const payload: OrderRejectedEvent = {
      pedidoId,
      estado: 'rejected',
      reason,
    };
    this.nats.emit(ORDER_REJECTED, payload);
  }

  private emitirVerifying(pedidoId: string): void {
    const payload: OrderVerifyingEvent = {
      pedidoId,
      estado: 'verifying',
      startedAt: new Date().toISOString(),
    };
    this.nats.emit(ORDER_VERIFYING, payload);
  }

  private emitirPreparing(pedidoId: string): void {
    const payload: OrderPreparingEvent = {
      pedidoId,
      estado: 'preparing',
      startedAt: new Date().toISOString(),
    };
    this.nats.emit(ORDER_PREPARING, payload);
  }

  private emitirReady(pedidoId: string): void {
    const payload: OrderReadyEvent = {
      pedidoId,
      estado: 'ready',
      preparedAt: new Date().toISOString(),
    };
    this.nats.emit(ORDER_READY, payload);
  }

  /** Pausa artificial para "simular" trabajo (la preparación de la pizza). */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }


  /** getItem por PK en la tabla de productos. */
  private async buscarProducto(
    productoId: string,
  ): Promise<Producto | undefined> {
    const res = await this.dynamo.send(
      new GetCommand({
        TableName: this.tablaProductos,
        Key: { productoId },
      }),
    );
    return res.Item as Producto | undefined;
  }

  /** getItem por PK en la tabla de ingredientes. */
  private async buscarIngrediente(
    ingredienteId: string,
  ): Promise<Ingrediente | undefined> {
    const res = await this.dynamo.send(
      new GetCommand({
        TableName: this.tablaIngredientes,
        Key: { ingredienteId },
      }),
    );
    return res.Item as Ingrediente | undefined;
  }

  /**
   * ¿Alcanza el stock para preparar UNA unidad de este producto?
   * Recorre la receta y, por cada ingrediente, compara la cantidad que pide
   * contra la disponible. Si falta alguno, devuelve false.
   *
   * Esto alimenta SOLO el flag informativo de products.get (ver getProducto).
   * La validación real de un pedido (receta × cantidad + extras, con descuento
   * de stock) es más completa y vive en el handler de order.created (4b).
   */
  private async hayStockParaUna(producto: Producto): Promise<boolean> {
    for (const item of producto.receta) {
      const ingrediente = await this.buscarIngrediente(item.ingredienteId);
      if (!ingrediente || ingrediente.cantidadDisponible < item.cantidad) {
        return false;
      }
    }
    return true;
  }
}
