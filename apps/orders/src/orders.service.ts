import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  NATS_SERVICE,
  ORDER_CREATED_EVENT,
  NOTIFICATIONS_STATUS_PATTERN,
  OrderCreatedEvent,
  NotificationsStatusRequest,
  NotificationsStatusResponse,
} from '@app/contracts';

import { REDIS_CLIENT } from './redis/redis.module';

export interface CreateOrderDto {
  customer: string;
  total: number;
}

const ORDER_KEY_PREFIX = 'order:';

@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(NATS_SERVICE) private readonly nats: ClientProxy,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async onModuleInit() {
    await this.nats.connect();
    this.logger.log('Conectado al broker NATS');
  }

  async createOrder(dto: CreateOrderDto): Promise<OrderCreatedEvent> {
    const event: OrderCreatedEvent = {
      orderId: randomUUID(),
      customer: dto.customer,
      total: dto.total,
      createdAt: new Date().toISOString(),
    };

    await this.redis.set(`${ORDER_KEY_PREFIX}${event.orderId}`, JSON.stringify(event));
    this.logger.log(`Guardado en Redis ${event.orderId}`);

    this.nats.emit<void, OrderCreatedEvent>(ORDER_CREATED_EVENT, event);
    this.logger.log(`Publicado ${ORDER_CREATED_EVENT} ${event.orderId}`);

    return event;
  }

  async findOrder(orderId: string): Promise<OrderCreatedEvent | null> {
    const raw = await this.redis.get(`${ORDER_KEY_PREFIX}${orderId}`);
    return raw ? (JSON.parse(raw) as OrderCreatedEvent) : null;
  }

  async getNotificationsStatus(customer: string): Promise<NotificationsStatusResponse> {
    const payload: NotificationsStatusRequest = { customer };
    this.logger.log(`Request ${NOTIFICATIONS_STATUS_PATTERN} (${customer})`);

    return firstValueFrom(
      this.nats.send<NotificationsStatusResponse, NotificationsStatusRequest>(
        NOTIFICATIONS_STATUS_PATTERN,
        payload,
      ),
    );
  }
}
