export const NOTIFICATIONS_STATUS_PATTERN = 'notifications.status';

export interface NotificationsStatusRequest {
  customer: string;
}

export interface NotificationsStatusResponse {
  customer: string;
  sent: number;
  lastSentAt: string | null;
}
