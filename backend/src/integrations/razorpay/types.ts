export interface RazorpayConfig {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
  baseUrl?: string;
}

export interface RazorpayOrderInput {
  amount: number; // In smallest currency unit (paise for INR, cents for USD)
  currency: string; // e.g. "INR", "USD"
  receipt?: string;
  notes?: Record<string, string>;
  paymentCapture?: boolean | 1 | 0;
}

export interface RazorpayOrderOutput {
  id: string; // e.g. "order_EKwxwAgItmmXdp"
  entity: 'order';
  amount: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  receipt?: string;
  status: 'created' | 'attempted' | 'paid';
  attempts: number;
  notes: Record<string, string>;
  createdAt: number;
}

export interface RazorpayPaymentDetails {
  id: string; // e.g. "pay_29QQoUBi66xm2f"
  entity: 'payment';
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  orderId?: string;
  method?: string;
  description?: string;
  email?: string;
  contact?: string;
  fee?: number;
  tax?: number;
  errorCode?: string;
  errorDescription?: string;
  createdAt: number;
}

export interface RazorpayRefundInput {
  paymentId: string;
  amount?: number;
  notes?: Record<string, string>;
  speed?: 'normal' | 'optimum';
}

export interface RazorpayRefundOutput {
  id: string; // e.g. "rfnd_EKwxwAgItmmXdp"
  entity: 'refund';
  amount: number;
  currency: string;
  paymentId: string;
  status: 'pending' | 'processed' | 'failed';
  speedProcessed?: string;
  notes: Record<string, string>;
  receipt?: string;
  createdAt: number;
}

export interface RazorpayVerificationInput {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface RazorpayWebhookPayload {
  entity: 'event';
  account_id: string;
  event: string; // e.g. "payment.captured", "payment.failed", "refund.processed"
  contains: string[];
  payload: {
    payment?: { entity: Record<string, unknown> };
    order?: { entity: Record<string, unknown> };
    refund?: { entity: Record<string, unknown> };
  };
  created_at: number;
}
