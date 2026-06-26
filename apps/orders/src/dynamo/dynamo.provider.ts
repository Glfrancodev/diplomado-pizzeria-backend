import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Provider } from '@nestjs/common';

/**
 * Provider del cliente DynamoDB para orders (mismo patrón que kitchen/delivery).
 *
 * - SIN credenciales en el código: en Fargate las inyecta el IAM task role.
 * - orders solo toca SU tabla (pizzeria-pedidos); su IAM role no le da acceso a
 *   ninguna otra. Para datos de comida/repartidores, orders pregunta por NATS.
 */
export const DYNAMO = 'DYNAMO';

export const dynamoProvider: Provider = {
  provide: DYNAMO,
  useFactory: (): DynamoDBDocumentClient => {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION,
      // Solo en local: si DYNAMO_ENDPOINT está seteado, apunta a DynamoDB Local
      // con credenciales truchas. En ECS la var NO existe → usa el endpoint real
      // y las credenciales del IAM task role.
      ...(process.env.DYNAMO_ENDPOINT && {
        endpoint: process.env.DYNAMO_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    });
    return DynamoDBDocumentClient.from(client);
  },
};
