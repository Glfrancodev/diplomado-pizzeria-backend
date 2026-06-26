import { Injectable, Logger } from '@nestjs/common';
import { OrderCreatedEvent, NotificationsStatusResponse } from '@app/contracts';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  private readonly sentByCustomer = new Map<string, { count: number; last: string }>();

  handleOrderCreated(event: OrderCreatedEvent): void {
    this.logger.log(
      `Enviando notificacion a ${event.customer} por orden ${event.orderId} ($${event.total})`,
    );

    const prev = this.sentByCustomer.get(event.customer);
    this.sentByCustomer.set(event.customer, {
      count: (prev?.count ?? 0) + 1,
      last: new Date().toISOString(),
    });
  }

  getStatus(customer: string): NotificationsStatusResponse {
    const entry = this.sentByCustomer.get(customer);
    return {
      customer,
      sent: entry?.count ?? 0,
      lastSentAt: entry?.last ?? null,
    };
  }
}
