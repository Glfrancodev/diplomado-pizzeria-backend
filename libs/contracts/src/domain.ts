/**
 * domain.ts — Las "formas" (tipos) de las entidades del dominio.
 *
 * Acá NO hay lógica ni nombres de eventos: solo describimos cómo luce cada
 * registro que vive en DynamoDB. Estos tipos los comparten los 3 servicios,
 * así todos hablan de "un Pedido" o "un Producto" con exactamente los mismos
 * campos. Los contratos de NATS (events.contracts.ts / messages.contracts.ts)
 * van a reutilizar estos tipos en vez de redefinirlos.
 *
 * Regla de oro del proyecto: cada tabla tiene UN dueño. Anotamos el dueño al
 * lado de cada entidad para no perderlo de vista.
 */

// ───────────────────────────────────────────────────────────────────────────
// Estados de un pedido (la "máquina de estados" por la que pasa)
//   pending → verifying → preparing → ready → (searching_delivery) → on_the_way → delivered
//                       ↘ rejected (si kitchen no tiene stock)
// Usar un union de strings (en vez de string suelto) hace que el compilador
// nos avise si escribimos mal un estado.
//   verifying          = kitchen recibió el pedido y está validando el stock.
//   searching_delivery = no había repartidor libre; el pedido espera en cola.
//   on_the_way         = delivery asignó un repartidor y está "viajando" (simulado).
//
// Tiempos (para que el frontend, que hace polling cada 2s, vea cada estado):
//   - mínimo 4s entre estados "instantáneos".
//   - los estados que simulan trabajo (preparing, on_the_way) duran ~10s.
// ───────────────────────────────────────────────────────────────────────────
export type EstadoPedido =
  | 'pending'
  | 'verifying'
  | 'preparing'
  | 'ready'
  | 'rejected'
  | 'searching_delivery'
  | 'on_the_way'
  | 'delivered';

export type EstadoRepartidor = 'disponible' | 'ocupado';

// ───────────────────────────────────────────────────────────────────────────
// pizzeria-pedidos · dueño: orders
// PK (DynamoDB): pedidoId
// ───────────────────────────────────────────────────────────────────────────

/** Datos del cliente que hizo el pedido (objeto anidado dentro del Pedido). */
export interface Cliente {
  nombre: string;
  correo: string;
}

/**
 * Una línea del pedido = un tipo de pizza con su cantidad y sus extras.
 * El pedido tiene una LISTA de líneas, así un mismo pedido puede llevar
 * varias pizzas distintas.
 */
export interface LineaPedido {
  productoId: string; // qué pizza (slug, ej: "prod-jalapeno")
  cantidad: number; // cuántas de esa pizza
  extras: string[]; // ingredientes extra (ids), ej: ["ing-queso", "ing-peperoni"]
  subtotal: number; // (precioBase + nº_extras × 5) × cantidad — lo calcula orders
}

export interface Pedido {
  pedidoId: string; // PK · UUID generado en runtime
  cliente: Cliente;
  direccion: string;
  estado: EstadoPedido;
  lineas: LineaPedido[];
  total: number; // suma de los subtotales — lo calcula orders
  repartidor: string | null; // repartidorId asignado, null hasta que delivery lo asigna
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

// ───────────────────────────────────────────────────────────────────────────
// pizzeria-productos · dueño: kitchen — el menú + la receta base
// PK (DynamoDB): productoId
// ───────────────────────────────────────────────────────────────────────────

/** Un ingrediente dentro de la receta de un producto, con cuánto consume. */
export interface IngredienteReceta {
  ingredienteId: string;
  cantidad: number; // cuánto stock consume esta pizza de ese ingrediente
}

export interface Producto {
  productoId: string; // PK · slug legible (ej: "prod-jalapeno")
  nombre: string;
  precioBase: number; // orders lo pide para calcular el total
  receta: IngredienteReceta[]; // lista: una pizza usa varios ingredientes
}

// ───────────────────────────────────────────────────────────────────────────
// pizzeria-ingredientes · dueño: kitchen — el stock
// PK (DynamoDB): ingredienteId
// ───────────────────────────────────────────────────────────────────────────

export interface Ingrediente {
  ingredienteId: string; // PK · slug legible (ej: "ing-queso")
  nombre: string;
  cantidadDisponible: number; // kitchen lo descuenta al validar un pedido
}

// ───────────────────────────────────────────────────────────────────────────
// pizzeria-repartidores · dueño: delivery
// PK (DynamoDB): repartidorId
// ───────────────────────────────────────────────────────────────────────────

export interface Repartidor {
  repartidorId: string; // PK · UUID o slug
  nombre: string;
  correo: string;
  estado: EstadoRepartidor; // disponible | ocupado
  pedido: string | null; // pedidoId que está entregando, null si está libre
}
