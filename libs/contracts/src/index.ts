/**
 * Punto de entrada de la librería compartida @app/contracts.
 * Los 3 servicios importan desde acá: `import { Pedido, ORDER_CREATED } from '@app/contracts'`.
 */
export * from './nats.constants';
export * from './domain';
export * from './events.contracts';
export * from './messages.contracts';
