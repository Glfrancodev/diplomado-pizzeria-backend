/**
 * messages.contracts.ts — Los MENSAJES de NATS (patrón request/response).
 *
 * A diferencia de un evento, un mensaje se ENVÍA (send / @MessagePattern) y el
 * que lo manda SÍ espera una respuesta. Es como una llamada a función, pero
 * cruzando la red por NATS.
 *
 * orders es siempre quien pregunta (es la única puerta HTTP). kitchen y
 * delivery responden. Acá orders consigue datos de comida/repartidores SIN
 * tocar tablas ajenas (database-per-service estricto).
 *
 * Por cada mensaje exportamos:
 *   1. la CONSTANTE con el nombre del subject.
 *   2. la interface del REQUEST (lo que orders manda).
 *   3. la interface del RESPONSE (lo que kitchen/delivery devuelve).
 * Cuando un request no necesita datos, usamos `void` (no hace falta interface).
 */

import { Producto, Ingrediente, Repartidor, IngredienteReceta } from './domain';

// ═══════════════════════════════════════════════════════════════════════════
// LECTURAS de comida — orders → kitchen
// ═══════════════════════════════════════════════════════════════════════════

// ── products.list ─ "Dame el menú completo." (request sin datos) ────────────
export const PRODUCTS_LIST = 'products.list';
export type ProductsListResponse = Producto[];

// ── products.get ─ "Dame este producto (receta + precioBase + stock)." ──────
// orders lo usa al crear un pedido: necesita el precioBase para calcular el
// total (opción a: orders pide precioBase y aplica la fórmula él mismo).
export const PRODUCTS_GET = 'products.get';

export interface ProductsGetRequest {
  productoId: string;
}

/**
 * Devolvemos el Producto + la disponibilidad calculada de cada ingrediente de
 * su receta, así el front puede mostrar "agotado" sin que orders lea el stock.
 */
export interface ProductsGetResponse {
  producto: Producto;
  disponible: boolean; // ¿hay stock para armar al menos una?
}

// ── ingredients.list ─ "Dame los ingredientes (para elegir extras)." ────────
export const INGREDIENTS_LIST = 'ingredients.list';
export type IngredientsListResponse = Ingrediente[];

// ═══════════════════════════════════════════════════════════════════════════
// ALTAS (create) — orders es la puerta; el dueño es quien escribe en su tabla
// ═══════════════════════════════════════════════════════════════════════════

// ── products.create ─ orders → kitchen (kitchen escribe en pizzeria-productos)
export const PRODUCTS_CREATE = 'products.create';

export interface ProductsCreateRequest {
  productoId: string; // slug a mano, ej: "prod-jalapeno"
  nombre: string;
  precioBase: number;
  receta: IngredienteReceta[];
}
export type ProductsCreateResponse = Producto;

// ── ingredients.create ─ orders → kitchen (escribe en pizzeria-ingredientes) ─
export const INGREDIENTS_CREATE = 'ingredients.create';

export interface IngredientsCreateRequest {
  ingredienteId: string; // slug a mano, ej: "ing-queso"
  nombre: string;
  cantidadDisponible: number;
}
export type IngredientsCreateResponse = Ingrediente;

// ── repartidores.create ─ orders → delivery (escribe en pizzeria-repartidores)
export const REPARTIDORES_CREATE = 'repartidores.create';

export interface RepartidoresCreateRequest {
  nombre: string;
  correo: string;
  // repartidorId lo genera delivery (UUID), por eso no viene en el request.
}
export type RepartidoresCreateResponse = Repartidor;
