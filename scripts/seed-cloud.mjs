/**
 * seed-cloud.mjs — Puebla la pizzería EN LA NUBE, por la API (a través del ALB).
 *
 * A diferencia de seed-local.mjs (que escribe directo en DynamoDB Local), este
 * script NO toca DynamoDB: hace POST a los endpoints de orders, que reenvía por
 * NATS a kitchen/delivery (los dueños de cada tabla). Es la forma correcta de
 * sembrar en prod, respetando el patrón gateway + database-per-service.
 *
 * Uso:
 *   node scripts/seed-cloud.mjs http://<alb_dns_name>
 *   # o:  API_URL=http://<alb_dns_name> node scripts/seed-cloud.mjs
 */
const API = (process.env.API_URL ?? process.argv[2] ?? '').replace(/\/$/, '');

if (!API) {
  console.error(
    'Falta la URL del ALB.\n  node scripts/seed-cloud.mjs http://<alb_dns_name>',
  );
  process.exit(1);
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return text;
}

// Orden: primero ingredientes (las recetas los referencian), después productos,
// y por último repartidores (independientes).
const ingredientes = [
  { ingredienteId: 'ing-salsa', nombre: 'Salsa de tomate', cantidadDisponible: 100 },
  { ingredienteId: 'ing-queso', nombre: 'Queso', cantidadDisponible: 100 },
  { ingredienteId: 'ing-peperoni', nombre: 'Peperoni', cantidadDisponible: 100 },
  { ingredienteId: 'ing-jalapeno', nombre: 'Jalapeño', cantidadDisponible: 50 },
];

const productos = [
  {
    productoId: 'prod-margarita',
    nombre: 'Pizza Margarita',
    precioBase: 80,
    receta: [
      { ingredienteId: 'ing-salsa', cantidad: 3 },
      { ingredienteId: 'ing-queso', cantidad: 5 },
    ],
  },
  {
    productoId: 'prod-jalapeno',
    nombre: 'Pizza Jalapeño',
    precioBase: 100,
    receta: [
      { ingredienteId: 'ing-salsa', cantidad: 3 },
      { ingredienteId: 'ing-queso', cantidad: 5 },
      { ingredienteId: 'ing-peperoni', cantidad: 8 },
      { ingredienteId: 'ing-jalapeno', cantidad: 5 },
    ],
  },
];

// Repartidores = delivery. Solo nombre + correo; delivery genera el id (UUID).
const repartidores = [
  { nombre: 'Juan', correo: 'juan@piz.com' },
  { nombre: 'Ana', correo: 'ana@piz.com' },
];

async function main() {
  console.log(`Sembrando en ${API} ...`);

  for (const it of ingredientes) {
    await post('/ingredients', it);
    console.log(`  ✓ ingrediente ${it.ingredienteId}`);
  }
  for (const it of productos) {
    await post('/products', it);
    console.log(`  ✓ producto ${it.productoId}`);
  }
  for (const it of repartidores) {
    await post('/repartidores', it);
    console.log(`  ✓ repartidor ${it.nombre}`);
  }

  console.log('✅ Pizzería poblada en la nube.');
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
