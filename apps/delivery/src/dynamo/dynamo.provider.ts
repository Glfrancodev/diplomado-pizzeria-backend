import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Provider } from '@nestjs/common';

/**
 * Provider del cliente DynamoDB para delivery (mismo patrón que kitchen).
 *
 * - SIN credenciales en el código: en Fargate las inyecta el IAM task role.
 * - delivery solo toca SU tabla (pizzeria-repartidores); su IAM role no le da
 *   acceso a ninguna otra (database-per-service estricto).
 */
export const DYNAMO = 'DYNAMO';

export const dynamoProvider: Provider = {
  provide: DYNAMO,
  useFactory: (): DynamoDBDocumentClient => {
    const client = new DynamoDBClient({ region: process.env.AWS_REGION });
    return DynamoDBDocumentClient.from(client);
  },
};
