import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  ORDER_CREATED_EVENT,
  NOTIFICATIONS_STATUS_PATTERN,
  OrderCreatedEvent,
  NotificationsStatusRequest,
  NotificationsStatusResponse,
} from '@app/contracts';
import { NotificationsService } from './notifications.service';

@Controller()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @EventPattern(ORDER_CREATED_EVENT)
  onOrderCreated(@Payload() event: OrderCreatedEvent): void {
    this.notificationsService.handleOrderCreated(event);
  }

  @MessagePattern(NOTIFICATIONS_STATUS_PATTERN)
  status(@Payload() payload: NotificationsStatusRequest): NotificationsStatusResponse {
    return this.notificationsService.getStatus(payload.customer);
  }
}
