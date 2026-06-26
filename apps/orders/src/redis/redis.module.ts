import { Global, Module, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';
export const DEFAULT_REDIS_URL = 'redis://localhost:6379';

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  private readonly logger = new Logger('Redis');
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit();
    this.logger.log('Conexion a Redis cerrada');
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const logger = new Logger('Redis');
        const url = process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
        const client = new Redis(url, { lazyConnect: false });

        client.on('connect', () => logger.log(`Conectado a ${url}`));
        client.on('error', (err) => logger.error(`Error: ${err.message}`));

        return client;
      },
    },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
