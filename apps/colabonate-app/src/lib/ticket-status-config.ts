import type { TicketStatus } from '../types/api'

export const statusColor: Record<TicketStatus, 'default' | 'warning' | 'success' | 'error' | 'info'> = {
  PENDING:     'default',
  ACCEPTED:    'info',
  PAID:        'info',
  IN_PROGRESS: 'info',
  COMPLETED:   'success',
  DISPUTED:    'error',
  CANCELLED:   'default',
}

export const statusLabel: Record<TicketStatus, string> = {
  PENDING:     'Pending',
  ACCEPTED:    'Accepted',
  PAID:        'Paid',
  IN_PROGRESS: 'In Progress',
  COMPLETED:   'Completed',
  DISPUTED:    'Disputed',
  CANCELLED:   'Cancelled',
}
