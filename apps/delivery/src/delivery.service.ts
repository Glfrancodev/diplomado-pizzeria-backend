import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { randomUUID } from 'crypto';
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  Repartidor,
  RepartidoresCreateRequest,
  OrderReadyEvent,
  OrderSearchingDeliveryEvent,
  OrderOnTheWayEvent,
  OrderDeliveredEvent,
  NATS_SERVICE,
  ORDER_SEARCHING_DELIVERY,
  ORDER_ON_THE_WAY,
  ORDER_DELIVERED,
} from '@app/contracts';
import { DYNAMO } from './dynamo/dynamo.provider';

/**
 * Lógica de delivery. Dueña de la tabla pizzeria-repartidores (DynamoDB).
 *
 * - Escucha order.ready → asigna un repartidor; si no hay libre, el pedido espera
 *   en una cola (en memoria) hasta que uno se libere. Estados que emite:
 *   searching_delivery (en cola) → on_the_way (viajando) → delivered (entregado).
 * - delivery NO escribe en pedidos: emite eventos y orders persiste el estado
 *   (un solo escritor por tabla).
 *
 * ⚠️ La cola vive en MEMORIA: si el contenedor se reinicia, los pedidos en espera
 * se pierden (igual que kitchen pierde un "preparing" si se reinicia). Aceptable
 * en una demo; en prod iría una cola durable (SQS / NATS JetStream).
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  private readonly tablaRepartidores = process.env.TABLE_REPARTIDORES;

  /** Cola FIFO en memoria de pedidos esperando un repartidor libre. */
  private readonly cola: OrderReadyEvent[] = [];

  constructor(
    @Inject(DYNAMO) private readonly dynamo: DynamoDBDocumentClient,
    @Inject(NATS_SERVICE) private readonly nats: ClientProxy,
  ) {}

  // ─── ALTA ────────────────────────────────────────────────────────────────────

  /**
   * repartidores.create → delivery escribe el repartidor en SU tabla.
   * El repartidorId lo genera delivery (UUID), porque no es un slug a mano.
   * Nace "disponible" y sin pedido.
   */
  async createRepartidor(req: RepartidoresCreateRequest): Promise<Repartidor> {
    const repartidor: Repartidor = {
      repartidorId: randomUUID(),
      nombre: req.nombre,
      correo: req.correo,
      estado: 'disponible',
      pedido: null,
    };
    await this.dynamo.send(
      new PutCommand({ TableName: this.tablaRepartidores, Item: repartidor }),
    );
    this.logger.log(`Repartidor creado: ${repartidor.repartidorId}`);
    return repartidor;
  }

  // ─── ASIGNACIÓN AL RECIBIR order.ready ───────────────────────────────────────

  /**
   * order.ready → intentar asignar un repartidor. Si no hay libre, el pedido
   * espera en la cola hasta que uno se libere (ver procesarCola).
   */
  async handleOrderReady(event: OrderReadyEvent): Promise<void> {
    this.logger.log(`order.ready recibido: ${event.pedidoId}`);
    await this.intentarAsignar(event);
  }

  /**
   * Intenta reclamar un repartidor para el pedido:
   *   - Si lo consigue → lo entrega (on_the_way → viaje → delivered).
   *   - Si no hay libre → emite searching_delivery y lo encola.
   */
  private async intentarAsignar(event: OrderReadyEvent): Promise<void> {
    const repartidorId = await this.reclamarRepartidor(event.pedidoId);

    if (!repartidorId) {
      // No hay repartidor: a la cola (si no estaba ya).
      if (!this.cola.some((e) => e.pedidoId === event.pedidoId)) {
        this.cola.push(event);
        this.emitirSearching(event.pedidoId);
        this.logger.warn(
          `Sin repartidor libre: ${event.pedidoId} en cola (espera=${this.cola.length})`,
        );
      }
      return;
    }

    await this.entregar(event.pedidoId, repartidorId);
  }

  /**
   * Con un repartidor ya reclamado: avisa "en camino", simula el viaje, libera
   * al repartidor, avisa "entregado" y atiende al próximo de la cola.
   */
  private async entregar(pedidoId: string, repartidorId: string): Promise<void> {
    this.emitirOnTheWay(pedidoId, repartidorId);
    this.logger.log(`Pedido ${pedidoId} en camino con ${repartidorId}`);

    await this.sleep(5000); // "simula" el viaje: no maneja nada real

    await this.liberar(repartidorId);
    this.emitirDelivered(pedidoId, repartidorId);
    this.logger.log(`Pedido ${pedidoId} entregado por ${repartidorId}`);

    // Se liberó un repartidor: si hay alguien esperando, atenderlo ahora.
    await this.procesarCola();
  }

  /** Toma el primer pedido de la cola (si hay) e intenta asignarle repartidor. */
  private async procesarCola(): Promise<void> {
    const siguiente = this.cola.shift();
    if (!siguiente) return;
    this.logger.log(
      `Atendiendo de la cola: ${siguiente.pedidoId} (restan=${this.cola.length})`,
    );
    await this.intentarAsignar(siguiente);
  }

  // ─── HELPERS (privados) ──────────────────────────────────────────────────────

  /**
   * Reclama un repartidor disponible de forma ATÓMICA y devuelve su id (o
   * undefined si no hay). Escanea los disponibles y, por cada candidato, intenta
   * marcarlo ocupado con un ConditionExpression: solo gana si SIGUE disponible.
   * Así dos pedidos en cola nunca se quedan con el mismo repartidor.
   */
  private async reclamarRepartidor(
    pedidoId: string,
  ): Promise<string | undefined> {
    const res = await this.dynamo.send(
      new ScanCommand({
        TableName: this.tablaRepartidores,
        FilterExpression: 'estado = :d',
        ExpressionAttributeValues: { ':d': 'disponible' },
      }),
    );
    const candidatos = (res.Items ?? []) as Repartidor[];

    for (const candidato of candidatos) {
      const ganado = await this.marcarOcupado(candidato.repartidorId, pedidoId);
      if (ganado) return candidato.repartidorId;
      // Otro pedido se lo llevó entre el scan y el update: probamos el siguiente.
    }
    return undefined;
  }

  /**
   * Marca al repartidor ocupado SOLO si sigue disponible (claim atómico).
   * Devuelve true si lo logró, false si otro lo tomó primero.
   */
  private async marcarOcupado(
    repartidorId: string,
    pedidoId: string,
  ): Promise<boolean> {
    try {
      await this.dynamo.send(
        new UpdateCommand({
          TableName: this.tablaRepartidores,
          Key: { repartidorId },
          UpdateExpression: 'SET estado = :o, pedido = :p',
          ConditionExpression: 'estado = :d', // solo si AÚN está disponible
          ExpressionAttributeValues: {
            ':o': 'ocupado',
            ':p': pedidoId,
            ':d': 'disponible',
          },
        }),
      );
      return true;
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        return false; // otro lo reclamó primero
      }
      throw err;
    }
  }

  /** Libera al repartidor: vuelve a disponible y sin pedido. */
  private async liberar(repartidorId: string): Promise<void> {
    await this.dynamo.send(
      new UpdateCommand({
        TableName: this.tablaRepartidores,
        Key: { repartidorId },
        UpdateExpression: 'SET estado = :d, pedido = :p',
        ExpressionAttributeValues: { ':d': 'disponible', ':p': null },
      }),
    );
  }

  private emitirSearching(pedidoId: string): void {
    const payload: OrderSearchingDeliveryEvent = {
      pedidoId,
      estado: 'searching_delivery',
      since: new Date().toISOString(),
    };
    this.nats.emit(ORDER_SEARCHING_DELIVERY, payload);
  }

  private emitirOnTheWay(pedidoId: string, repartidorId: string): void {
    const payload: OrderOnTheWayEvent = {
      pedidoId,
      estado: 'on_the_way',
      repartidor: repartidorId,
      startedAt: new Date().toISOString(),
    };
    this.nats.emit(ORDER_ON_THE_WAY, payload);
  }

  private emitirDelivered(pedidoId: string, repartidorId: string): void {
    const payload: OrderDeliveredEvent = {
      pedidoId,
      estado: 'delivered',
      repartidor: repartidorId,
      deliveredAt: new Date().toISOString(),
    };
    this.nats.emit(ORDER_DELIVERED, payload);
  }

  /** Pausa artificial para "simular" el viaje del repartidor. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
