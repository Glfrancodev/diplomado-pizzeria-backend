import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Provider } from '@nestjs/common';

/**
 * Provider del cliente DynamoDB para kitchen.
 *
 * - SIN credenciales en el código: en Fargate las inyecta el IAM task role.
 *   El SDK las toma solo; acá solo pasamos la región.
 * - Usamos DynamoDBDocumentClient (lib-dynamodb): nos deja leer/escribir objetos
 *   JS normales en vez de los tipos crudos de Dynamo ({ S: "..." }, { N: "..." }).
 *
 * `DYNAMO` es el "token": el nombre con el que el service pide este cliente
 * (@Inject(DYNAMO)).
 */
export const DYNAMO = 'DYNAMO';

export const dynamoProvider: Provider = {
  provide: DYNAMO,
  useFactory: (): DynamoDBDocumentClient => {
    const client = new DynamoDBClient({ region: process.env.AWS_REGION });
    return DynamoDBDocumentClient.from(client);
  },
};
