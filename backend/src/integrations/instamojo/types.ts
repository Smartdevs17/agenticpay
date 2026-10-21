export interface InstamojoConfig {
  apiKey?: string;
  authToken?: string;
  privateSalt?: string;
  endpointUrl?: string; // e.g. https://test.instamojo.com/api/1.1/ or https://www.instamojo.com/api/1.1/
  sandbox?: boolean;
}

export interface InstamojoPaymentRequestInput {
  purpose: string;
  amount: number | string;
  buyerName?: string;
  email?: string;
  phone?: string;
  redirectUrl?: string;
  webhookUrl?: string;
  allowRepeatedPayments?: boolean;
  sendEmail?: boolean;
  sendSms?: boolean;
  metadata?: Record<string, unknown>;
}

export interface InstamojoPaymentRequestOutput {
  id: string; // e.g. "d66cb29dd0534c018a3dda7fe5d822b2"
  phone?: string;
  email?: string;
  buyerName?: string;
  amount: string;
  purpose: string;
  status: 'Pending' | 'Completed' | 'Failed';
  longurl: string;
  shorturl?: string;
  redirectUrl?: string;
  webhookUrl?: string;
  createdAt: string;
  modifiedAt?: string;
}

export interface InstamojoPaymentDetails {
  paymentId: string; // e.g. "MOJO5a06005J21512197"
  paymentRequestId: string;
  status: 'Credit' | 'Failed';
  currency: string;
  amount: string;
  buyerName?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  mac?: string;
  fees?: string;
  createdAt: string;
}

export interface InstamojoRefundInput {
  paymentId: string;
  type: 'RFD' | 'TNR' | 'QFL' | 'QNR' | 'EWN' | 'TAN' | 'PTH'; // RFD: Duplicate/unexpected, TNR: Product not received, etc.
  body: string;
  refundAmount?: number | string;
}

export interface InstamojoRefundOutput {
  id: string;
  paymentId: string;
  status: 'Pending' | 'Refunded' | 'Failed';
  type: string;
  body: string;
  refundAmount: string;
  totalAmount: string;
  createdAt: string;
}

export interface InstamojoWebhookPayload {
  payment_id: string;
  payment_request_id: string;
  status: 'Credit' | 'Failed';
  amount: string;
  buyer_name?: string;
  buyer_phone?: string;
  buyer?: string; // email
  currency?: string;
  fees?: string;
  mac?: string;
  longurl?: string;
  shorturl?: string;
  purpose?: string;
  [key: string]: string | undefined;
}
