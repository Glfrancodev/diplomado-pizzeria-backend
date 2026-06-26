/**
 * seed-local.mjs — Prepara DynamoDB Local para desarrollo.
 *
 * Crea las 4 tablas (con la MISMA partition key que la infra real) y siembra
 * datos de prueba (ingredientes, productos y repartidores).
 *
 * ⚠️ Esto es SOLO una herramienta de desarrollo local. En AWS, las tablas las
 * crea Terraform (el backend NUNCA hace CreateTable). Este script no corre en prod.
 *
 * Uso (con docker-compose arriba):  node scripts/seed-local.mjs
 */
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const endpoint = process.env.DYNAMO_ENDPOINT ?? 'http://localhost:8000';
const region = process.env.AWS_REGION ?? 'us-east-1';

const base = new DynamoDBClient({
  region,
  endpoint,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});
const doc = DynamoDBDocumentClient.from(base);

// Las 4 tablas, con su partition key EXACTA (igual a la infra).
const TABLES = [
  { name: 'pizzeria-pedidos', pk: 'pedidoId' },
  { name: 'pizzeria-productos', pk: 'productoId' },
  { name: 'pizzeria-ingredientes', pk: 'ingredienteId' },
  { name: 'pizzeria-repartidores', pk: 'repartidorId' },
];

async function existe(name) {
  try {
    await base.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch {
    return false;
  }
}

async function crearTablas() {
  for (const t of TABLES) {
    if (await existe(t.name)) {
      console.log(`= ${t.name} ya existe`);
      continue;
    }
    await base.send(
      new CreateTableCommand({
        TableName: t.name,
        AttributeDefinitions: [{ AttributeName: t.pk, AttributeType: 'S' }],
        KeySchema: [{ AttributeName: t.pk, KeyType: 'HASH' }],
        BillingMode: 'PAY_PER_REQUEST',
      }),
    );
    console.log(`+ creada ${t.name} (PK ${t.pk})`);
  }
}

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

const repartidores = [
  { repartidorId: 'rep-juan', nombre: 'Juan', correo: 'juan@piz.com', estado: 'disponible', pedido: null },
  { repartidorId: 'rep-ana', nombre: 'Ana', correo: 'ana@piz.com', estado: 'disponible', pedido: null },
];

async function sembrar() {
  for (const it of ingredientes) {
    await doc.send(new PutCommand({ TableName: 'pizzeria-ingredientes', Item: it }));
  }
  for (const it of productos) {
    await doc.send(new PutCommand({ TableName: 'pizzeria-productos', Item: it }));
  }
  for (const it of repartidores) {
    await doc.send(new PutCommand({ TableName: 'pizzeria-repartidores', Item: it }));
  }
  console.log(
    `Sembrados: ${ingredientes.length} ingredientes, ${productos.length} productos, ${repartidores.length} repartidores`,
  );
}

await crearTablas();
await sembrar();
console.log('✅ DynamoDB Local listo (tablas + datos).');
