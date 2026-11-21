export const extensionPoints = [
  'payment:beforeProcess',
  'payment:afterProcess',
  'fee:calculate',
  'webhook:beforeSend',
  'notification:send',
] as const;

export type ExtensionPoint = (typeof extensionPoints)[number];

export interface PaymentBeforeProcessContext {
  payment: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface PaymentAfterProcessContext {
  payment: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface FeeCalculateContext {
  amount: number;
  currency: string;
  merchantId?: string;
  metadata?: Record<string, unknown>;
}

export interface WebhookBeforeSendContext {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface NotificationSendContext {
  channel: string;
  recipient: string;
  payload: unknown;
}

export type HookContextByExtensionPoint = {
  'payment:beforeProcess': PaymentBeforeProcessContext;
  'payment:afterProcess': PaymentAfterProcessContext;
  'fee:calculate': FeeCalculateContext;
  'webhook:beforeSend': WebhookBeforeSendContext;
  'notification:send': NotificationSendContext;
};

export type HookResult = void | unknown | Promise<void | unknown>;
