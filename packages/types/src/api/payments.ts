import type { Payment, PaymentStatus } from '../domain/payments.js';
import type { PaginatedResult, PaginationParams } from './common.js';

export interface ListPaymentsRequest extends PaginationParams {
  merchantId?: string;
  status?: PaymentStatus;
}

export type ListPaymentsResponse = PaginatedResult<Payment>;

export type GetPaymentResponse = Payment;

export type UpdatePaymentStatusRequest = {
  status: PaymentStatus;
};
