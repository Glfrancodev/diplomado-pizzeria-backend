/**
 * Lo que el frontend manda al crear un pedido (POST /orders).
 *
 * Importante: el front manda SOLO ids y cantidades. NO manda precios ni
 * subtotales — esos los calcula orders pidiéndole los precioBase a kitchen
 * (seguridad: nunca confiar en precios del navegador).
 */
export interface CreateOrderLineaDto {
  productoId: string;
  cantidad: number;
  extras: string[]; // ids de ingredientes extra
}

export interface CreateOrderDto {
  cliente: { nombre: string; correo: string };
  direccion: string;
  lineas: CreateOrderLineaDto[];
}
