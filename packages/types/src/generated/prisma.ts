// Generated from backend/prisma/schema.prisma by packages/types/scripts/generate-prisma-types.mjs.
// Do not edit by hand.

export type PrismaScalar = string | number | boolean | null | Record<string, unknown> | unknown[];
export type PrismaJson = PrismaScalar;

export type DbUserTier = 'free' | 'pro' | 'enterprise';
export type DbPaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'refunded';
export type DbPaymentType = 'milestone_payment' | 'full_payment' | 'refund';
export type DbProjectStatus = 'draft' | 'active' | 'completed' | 'cancelled' | 'disputed';
export type DbMilestoneStatus = 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected' | 'completed';
export type DbInvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
export type DbWebhookStatus = 'active' | 'disabled' | 'failed';
export type DbPaymentLinkStatus = 'active' | 'expired' | 'used' | 'disabled';
export type DbOutboxEventStatus = 'pending' | 'publishing' | 'published' | 'dead_letter';
export type DbPluginStatus = 'installed' | 'enabled' | 'disabled' | 'error';
export type DbEmailCategory = 'payment_receipt' | 'payment_confirmation' | 'refund_notification' | 'dispute_update' | 'weekly_summary' | 'marketing' | 'security_alert' | 'onboarding';
export type DbEmailStatus = 'pending' | 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed';
export type DbNotificationCategory = 'payment_notification' | 'dispute_alert' | 'project_update' | 'milestone_reminder' | 'security_alert' | 'subscription_update' | 'system_notification';
export type DbNotificationStatus = 'pending' | 'sent' | 'delivered' | 'clicked' | 'failed';
export type DbDeliveryProvider = 'smtp' | 'sendgrid';
export type DbApiVersionStatus = 'active' | 'deprecated' | 'sunset' | 'removed';

export interface DbUser {
  id: string;
  tenantId: string;
  email: string;
  tier: DbUserTier;
  walletAddress: string | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DbPayment {
  id: string;
  tenantId: string;
  txHash: string | null;
  amount: string;
  currency: string;
  network: string;
  status: DbPaymentStatus;
  type: DbPaymentType;
  projectTitle: string | null;
  projectId: string | null;
  milestoneId: string | null;
  userId: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  metadata: PrismaJson | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DbProject {
  id: string;
  title: string;
  description: string | null;
  status: DbProjectStatus;
  totalAmount: string;
  currency: string;
  clientAddress: string;
  freelancerAddress: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DbMilestone {
  id: string;
  projectId: string;
  title: string;
  amount: string;
  currency: string;
  status: DbMilestoneStatus;
  order: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DbInvoice {
  id: string;
  projectId: string;
  milestoneId: string | null;
  tenantId: string;
  amount: string;
  currency: string;
  status: DbInvoiceStatus;
  generatedAt: Date;
  dueAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DbWebhook {
  id: string;
  tenantId: string;
  userId: string | null;
  url: string;
  events: string[];
  secret: string;
  signatureVersion: string;
  secretExpiresAt: Date | null;
  rotatedAt: Date | null;
  encryptionPublicKey: string | null;
  status: DbWebhookStatus;
  failCount: number;
  lastFired: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DbPaymentLink {
  id: string;
  merchantId: string;
  amount: string | null;
  currency: string;
  description: string | null;
  status: DbPaymentLinkStatus;
  expiresAt: Date | null;
  metadata: PrismaJson | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DbAuditLog {
  id: string;
  timestamp: Date;
  actor: string;
  action: string;
  resource: string;
  details: PrismaJson | null;
  previousHash: string;
  hash: string;
  anchorId: string | null;
  archivedAt: Date | null;
  coldArchivedAt: Date | null;
  entityId: string | null;
  entityType: string | null;
  userId: string | null;
  metadata: PrismaJson | null;
  ipAddress: string | null;
  createdAt: Date;
}

export interface DbOutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: PrismaJson;
  status: DbOutboxEventStatus;
  attempts: number;
  lastError: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbPlugin {
  id: string;
  name: string;
  version: string;
  source: string;
  status: DbPluginStatus;
  compatibility: PrismaJson;
  health: PrismaJson;
  installedAt: Date;
  updatedAt: Date;
  disabledAt: Date | null;
}

export interface DbPluginConfig {
  id: string;
  pluginId: string;
  environment: string;
  config: PrismaJson;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbPluginAuditLog {
  id: string;
  pluginId: string;
  actorId: string | null;
  action: string;
  details: PrismaJson | null;
  createdAt: Date;
}

export interface DbAuditAnchor {
  id: string;
  latestHash: string;
  chain: string;
  transactionHash: string | null;
  blockNumber: string | null;
  status: string;
  error: string | null;
  createdAt: Date;
}

export interface DbAccountLockout {
  id: string;
  accountId: string;
  ipAddress: string | null;
  failedAttempts: number;
  lockedUntil: Date | null;
  unlockTokenHash: string | null;
  lastFailedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbLoginAttempt {
  id: string;
  accountId: string;
  ipAddress: string;
  userAgent: string | null;
  success: boolean;
  reason: string | null;
  createdAt: Date;
}

export interface DbWebhookSecret {
  id: string;
  merchantId: string;
  keyId: string;
  secretHash: string;
  version: string;
  activeFrom: Date;
  expiresAt: Date;
  rotatedAt: Date | null;
  createdAt: Date;
}

export interface DbVulnerabilityReport {
  id: string;
  source: string;
  scannedAt: Date;
  summary: PrismaJson;
  artifactUrl: string | null;
}

export interface DbDependencyVulnerability {
  id: string;
  reportId: string;
  ecosystem: string;
  packageName: string;
  installedVersion: string | null;
  fixedVersion: string | null;
  severity: string;
  advisoryId: string | null;
  title: string;
  remediation: string | null;
  dueAt: Date | null;
  createdAt: Date;
}

export interface DbGasEstimate {
  id: string;
  network: string;
  gasPriceGwei: string;
  baseFeeGwei: string | null;
  priorityFeeGwei: string | null;
  recordedAt: Date;
}

export interface DbSandboxAccount {
  id: string;
  tenantId: string;
  userId: string | null;
  name: string;
  email: string;
  walletAddress: string;
  fakeBalance: string;
  currency: string;
  isActive: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DbSandboxTransaction {
  id: string;
  accountId: string;
  txHash: string;
  amount: string;
  currency: string;
  fromAddress: string;
  toAddress: string;
  status: string;
  type: string;
  mockData: PrismaJson | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DbSandboxMigration {
  id: string;
  tenantId: string;
  sourceAccountId: string;
  targetAccountId: string | null;
  status: string;
  steps: PrismaJson | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbEmailTemplate {
  id: string;
  tenantId: string;
  name: string;
  category: DbEmailCategory;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  variables: string[];
  isActive: boolean;
  locale: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DbEmailTemplateLocalization {
  id: string;
  templateId: string;
  locale: string;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbEmailDelivery {
  id: string;
  tenantId: string;
  templateId: string | null;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  status: DbEmailStatus;
  provider: DbDeliveryProvider;
  providerId: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  bouncedAt: Date | null;
  bounceReason: string | null;
  retryCount: number;
  error: string | null;
  metadata: PrismaJson | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbEmailPreference {
  id: string;
  tenantId: string;
  userId: string | null;
  email: string;
  paymentReceipts: boolean;
  paymentConfirmations: boolean;
  refundNotifications: boolean;
  disputeUpdates: boolean;
  weeklySummaries: boolean;
  marketing: boolean;
  securityAlerts: boolean;
  onboarding: boolean;
  locale: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbEmailAnalytics {
  id: string;
  tenantId: string;
  templateId: string | null;
  category: DbEmailCategory;
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  bouncedCount: number;
  failedCount: number;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbPushSubscription {
  id: string;
  tenantId: string;
  userId: string;
  endpoint: string;
  auth: string;
  p256dh: string;
  userAgent: string | null;
  isActive: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DbPushPreference {
  id: string;
  tenantId: string;
  userId: string;
  paymentNotifications: boolean;
  disputeAlerts: boolean;
  projectUpdates: boolean;
  milestoneReminders: boolean;
  securityAlerts: boolean;
  subscriptionUpdates: boolean;
  systemNotifications: boolean;
  groupNotifications: boolean;
  notifySound: boolean;
  notifyBadge: boolean;
  locale: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbNotificationLog {
  id: string;
  tenantId: string;
  userId: string;
  subscriptionId: string | null;
  category: DbNotificationCategory;
  status: DbNotificationStatus;
  title: string;
  body: string;
  icon: string | null;
  badge: string | null;
  tag: string | null;
  data: PrismaJson | null;
  deepLink: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  clickedAt: Date | null;
  error: string | null;
  retryCount: number;
  metadata: PrismaJson | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbApiVersion {
  id: string;
  version: string;
  status: DbApiVersionStatus;
  releaseDate: Date;
  deprecationDate: Date | null;
  sunsetDate: Date | null;
  description: string | null;
  changelogUrl: string | null;
  migrationGuideUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbApiVersionUsage {
  id: string;
  versionId: string;
  date: Date;
  requestCount: number;
  uniqueClients: number;
  createdAt: Date;
}

export interface DbApiVersionEndpoint {
  id: string;
  versionId: string;
  path: string;
  method: string;
  status: DbApiVersionStatus;
  changes: string | null;
  migrationNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}
