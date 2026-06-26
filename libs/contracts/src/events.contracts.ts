/**
 * events.contracts.ts — Los EVENTOS de NATS (patrón fire-and-forget).
 *
 * Un evento se EMITE (emit / @EventPattern) y el que lo manda NO espera
 * respuesta: avisa que "algo pasó" y sigue. Acá vive la cadena asíncrona de un
 * pedido:
 *
 *   order.created → kitchen valida stock
 *                 → order.preparing → (simula 3s) → order.ready / order.rejected
 *                 → delivery asigna repartidor → order.delivered
 *
 * Por cada evento exportamos DOS cosas:
 *   1. una CONSTANTE con el nombre del subject (el string que viaja por NATS),
 *      para que emisor y receptor usen exactamente el mismo y no haya typos.
 *   2. una INTERFACE con la forma del payload (los datos que lleva el evento).
 */

import { EstadoPedido } from './domain';

// ───────────────────────────────────────────────────────────────────────────
// order.created · emite: orders → escucha: kitchen
// "Se creó un pedido nuevo, validá el stock."
// Lleva solo lo que kitchen necesita para validar: qué pizzas y con qué extras.
// (No manda subtotales ni precios: a kitchen el dinero no le importa.)
// ───────────────────────────────────────────────────────────────────────────
export const ORDER_CREATED = 'order.created';

/** Una línea tal como viaja en el evento (sin subtotal: kitchen no lo usa). */
export interface LineaEvento {
  productoId: string;
  cantidad: number;
  extras: string[]; // ids de ingredientes extra
}

export interface OrderCreatedEvent {
  pedidoId: string;
  lineas: LineaEvento[];
}

// ───────────────────────────────────────────────────────────────────────────
// order.verifying · emite: kitchen → escucha: orders
// "Recibí el pedido y estoy validando el stock." Se emite al empezar a verificar,
// antes de decidir preparing o rejected (el front ve "Verificando").
// ───────────────────────────────────────────────────────────────────────────
export const ORDER_VERIFYING = 'order.verifying';

export interface OrderVerifyingEvent {
  pedidoId: string;
  estado: Extract<EstadoPedido, 'verifying'>; // siempre "verifying"
  startedAt: string; // ISO timestamp
}

// ───────────────────────────────────────────────────────────────────────────
// order.preparing · emite: kitchen → escucha: orders
// "Hay stock, ya estoy preparando." (orders lo persiste para que el front vea
// "Preparándose" sin esperar a que termine.)
// ───────────────────────────────────────────────────────────────────────────
export const ORDER_PREPARING = 'order.preparing';

export interface OrderPreparingEvent {
  pedidoId: string;
  estado: Extract<EstadoPedido, 'preparing'>; // siempre "preparing"
  startedAt: string; // ISO timestamp
}

// ───────────────────────────────────────────────────────────────────────────
// order.ready · emite: kitchen → escuchan: orders Y delivery
// "Pizza lista." orders actualiza estado; delivery arranca a asignar repartidor.
// ───────────────────────────────────────────────────────────────────────────
export const ORDER_READY = 'order.ready';

export interface OrderReadyEvent {
  pedidoId: string;
  estado: Extract<EstadoPedido, 'ready'>; // siempre "ready"
  preparedAt: string; // ISO timestamp
}

// ───────────────────────────────────────────────────────────────────────────
// order.rejected · emite: kitchen → escucha: orders
// "No hay stock para este pedido." reason explica qué faltó.
// ───────────────────────────────────────────────────────────────────────────
export const ORDER_REJECTED = 'order.rejected';

export interface OrderRejectedEvent {
  pedidoId: string;
  estado: Extract<EstadoPedido, 'rejected'>; // siempre "rejected"
  reason: string; // ej: "Sin stock de ing-jalapeno"
}

// ───────────────────────────────────────────────────────────────────────────
// order.searching_delivery · emite: delivery → escucha: orders
// "No había repartidor libre; el pedido quedó en cola esperando uno." delivery
// lo emite al encolar; cuando se libere un repartidor lo tomará de la cola y
// pasará a on_the_way.
// ───────────────────────────────────────────────────────────────────────────
export const ORDER_SEARCHING_DELIVERY = 'order.searching_delivery';

export interface OrderSearchingDeliveryEvent {
  pedidoId: string;
  estado: Extract<EstadoPedido, 'searching_delivery'>; // siempre "searching_delivery"
  since: string; // ISO timestamp en que entró a la cola
}

// ───────────────────────────────────────────────────────────────────────────
// order.on_the_way · emite: delivery → escucha: orders
// "Repartidor asignado, pedido en camino." delivery lo emite al empezar el viaje
// (antes del sleep), así el front ve "En camino" mientras se simula la entrega.
// ───────────────────────────────────────────────────────────────────────────
export const ORDER_ON_THE_WAY = 'order.on_the_way';

export interface OrderOnTheWayEvent {
  pedidoId: string;
  estado: Extract<EstadoPedido, 'on_the_way'>; // siempre "on_the_way"
  repartidor: string; // repartidorId asignado
  startedAt: string; // ISO timestamp
}

// ───────────────────────────────────────────────────────────────────────────
// order.delivered · emite: delivery → escucha: orders
// "Pedido entregado." delivery NO escribe en la tabla pedidos: avisa por evento
// y orders persiste el estado final (un solo escritor por tabla).
// ───────────────────────────────────────────────────────────────────────────
export const ORDER_DELIVERED = 'order.delivered';

export interface OrderDeliveredEvent {
  pedidoId: string;
  estado: Extract<EstadoPedido, 'delivered'>; // siempre "delivered"
  repartidor: string; // repartidorId que entregó
  deliveredAt: string; // ISO timestamp
}
