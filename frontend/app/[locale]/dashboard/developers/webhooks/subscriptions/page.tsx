'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { apiCall } from '@/lib/api/client';
import type {
  WebhookSubscription,
  WebhookSubscriptionStatus,
  WebhookSubscriptionsResponse,
  CreateWebhookSubscriptionRequest,
} from '@/lib/api';
import {
  Plus,
  PauseCircle,
  PlayCircle,
  Trash2,
  RefreshCw,
  Webhook,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ExternalLink,
  Filter,
  Zap,
} from 'lucide-react';

const EVENT_TYPE_OPTIONS = [
  { label: 'Payment Created', value: 'payment.created' },
  { label: 'Payment Completed', value: 'payment.completed' },
  { label: 'Payment Failed', value: 'payment.failed' },
  { label: 'Invoice Created', value: 'invoice.created' },
  { label: 'Invoice Paid', value: 'invoice.paid' },
  { label: 'Invoice Overdue', value: 'invoice.overdue' },
  { label: 'Subscription Created', value: 'subscription.created' },
  { label: 'Subscription Cancelled', value: 'subscription.cancelled' },
  { label: 'Dispute Created', value: 'dispute.created' },
  { label: 'Dispute Resolved', value: 'dispute.resolved' },
  { label: 'Account Updated', value: 'account.updated' },
  { label: 'Payout Completed', value: 'payout.completed' },
];

function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
}: {
  options: { label: string; value: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onChange(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between h-10"
        >
          {selected.length === 0
            ? placeholder
            : `${selected.length} event type${selected.length > 1 ? 's' : ''} selected`}
          <Filter className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-2" align="start">
        <div className="space-y-1">
          {options.map((option) => {
            const isSelected = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              >
                <div
                  className={`flex h-4 w-4 items-center justify-center rounded-sm border ${
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground'
                  }`}
                >
                  {isSelected && (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StatusBadge({ status }: { status: WebhookSubscriptionStatus }) {
  switch (status) {
    case 'active':
      return (
        <Badge
          variant="default"
          className="bg-green-100 text-green-800 hover:bg-green-100"
        >
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Active
        </Badge>
      );
    case 'paused':
      return (
        <Badge
          variant="secondary"
          className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100"
        >
          <PauseCircle className="h-3 w-3 mr-1" />
          Paused
        </Badge>
      );
    case 'disabled':
      return (
        <Badge
          variant="destructive"
          className="bg-red-100 text-red-800 hover:bg-red-100"
        >
          <XCircle className="h-3 w-3 mr-1" />
          Disabled
        </Badge>
      );
  }
}

function DeliveryStatCard({
  icon,
  label,
  value,
  colorClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  colorClass: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={`p-1.5 rounded-md ${colorClass}`}>{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

const SUBSCRIPTION_API_BASE = '/webhooks/subscriptions';

export default function WebhookSubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  // Create form state
  const [formEventTypes, setFormEventTypes] = useState<string[]>([]);
  const [formTargetUrl, setFormTargetUrl] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formFilterExpression, setFormFilterExpression] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  const loadSubscriptions = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiCall<WebhookSubscriptionsResponse>(
        SUBSCRIPTION_API_BASE,
        { method: 'GET' },
      );
      setSubscriptions(response.subscriptions);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load webhook subscriptions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubscriptions();
  }, [loadSubscriptions]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formEventTypes.length === 0) {
      toast.error('Please select at least one event type');
      return;
    }
    if (!formTargetUrl) {
      toast.error('Please enter a target URL');
      return;
    }

    setFormSubmitting(true);
    try {
      const payload: CreateWebhookSubscriptionRequest = {
        eventTypes: formEventTypes,
        targetUrl: formTargetUrl,
        description: formDescription || undefined,
        filterExpression: formFilterExpression || undefined,
      };
      await apiCall<WebhookSubscription>(SUBSCRIPTION_API_BASE, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      toast.success('Webhook subscription created');
      setCreateDialogOpen(false);
      resetForm();
      loadSubscriptions();
    } catch (error) {
      console.error(error);
      toast.error('Failed to create webhook subscription');
    } finally {
      setFormSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormEventTypes([]);
    setFormTargetUrl('');
    setFormDescription('');
    setFormFilterExpression('');
  };

  const handleTogglePause = async (
    subscription: WebhookSubscription,
  ) => {
    try {
      if (subscription.status === 'active') {
        await apiCall<WebhookSubscription>(
          `${SUBSCRIPTION_API_BASE}/${subscription.id}/pause`,
          { method: 'POST' },
        );
        toast.success('Subscription paused');
      } else {
        await apiCall<WebhookSubscription>(
          `${SUBSCRIPTION_API_BASE}/${subscription.id}/resume`,
          { method: 'POST' },
        );
        toast.success('Subscription resumed');
      }
      loadSubscriptions();
    } catch (error) {
      console.error(error);
      toast.error(
        subscription.status === 'active'
          ? 'Failed to pause subscription'
          : 'Failed to resume subscription',
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiCall<void>(`${SUBSCRIPTION_API_BASE}/${id}`, {
        method: 'DELETE',
      });
      toast.success('Webhook subscription deleted');
      setDeleteConfirmId(null);
      loadSubscriptions();
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete webhook subscription');
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      await apiCall<{ eventId: string }>(
        `${SUBSCRIPTION_API_BASE}/${id}/test`,
        { method: 'POST' },
      );
      toast.success('Sample event sent for testing');
    } catch (error) {
      console.error(error);
      toast.error('Failed to send test event');
    } finally {
      setTestingId(null);
    }
  };

  const formatLatency = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (loading) {
    return (
      <div className="space-y-8 pb-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Webhook Subscriptions
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Loading subscriptions...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-2"
      >
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Webhook Subscriptions
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage event subscriptions, monitor delivery health, and test
          endpoints.
        </p>
      </motion.div>

      {/* Subscriptions List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Subscriptions</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" onClick={loadSubscriptions}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
                <Dialog
                  open={createDialogOpen}
                  onOpenChange={(open) => {
                    setCreateDialogOpen(open);
                    if (!open) resetForm();
                  }}
                >
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      New Subscription
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Create Webhook Subscription</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleCreate} className="space-y-5">
                      <div className="space-y-2">
                        <Label>Event Types</Label>
                        <MultiSelect
                          options={EVENT_TYPE_OPTIONS}
                          selected={formEventTypes}
                          onChange={setFormEventTypes}
                          placeholder="Select event types..."
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="targetUrl">Target URL</Label>
                        <Input
                          id="targetUrl"
                          type="url"
                          placeholder="https://example.com/webhooks"
                          value={formTargetUrl}
                          onChange={(e) => setFormTargetUrl(e.target.value)}
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="description">
                          Description{' '}
                          <span className="text-muted-foreground">
                            (optional)
                          </span>
                        </Label>
                        <Textarea
                          id="description"
                          placeholder="e.g. Payment notifications for production"
                          value={formDescription}
                          onChange={(e) => setFormDescription(e.target.value)}
                          rows={2}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="filterExpression">
                          Filter Expression{' '}
                          <span className="text-muted-foreground">
                            (optional, JSONPath)
                          </span>
                        </Label>
                        <Input
                          id="filterExpression"
                          placeholder='e.g. $.amount > 100'
                          value={formFilterExpression}
                          onChange={(e) =>
                            setFormFilterExpression(e.target.value)
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Use JSONPath syntax to filter which events trigger
                          this subscription.
                        </p>
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setCreateDialogOpen(false);
                            resetForm();
                          }}
                        >
                          Cancel
                        </Button>
                        <Button type="submit" disabled={formSubmitting}>
                          {formSubmitting ? 'Creating...' : 'Create Subscription'}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {subscriptions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Webhook className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-2">
                  No webhook subscriptions configured
                </p>
                <p className="text-sm text-muted-foreground mb-6">
                  Create a subscription to start receiving webhook events.
                </p>
                <Dialog
                  open={createDialogOpen}
                  onOpenChange={(open) => {
                    setCreateDialogOpen(open);
                    if (!open) resetForm();
                  }}
                >
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Your First Subscription
                    </Button>
                  </DialogTrigger>
                </Dialog>
              </div>
            ) : (
              <div className="space-y-4">
                {subscriptions.map((subscription, index) => (
                  <motion.div
                    key={subscription.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="rounded-lg border p-4 space-y-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge status={subscription.status} />
                          {subscription.eventTypes.slice(0, 4).map((type) => (
                            <Badge
                              key={type}
                              variant="outline"
                              className="text-xs"
                            >
                              {type}
                            </Badge>
                          ))}
                          {subscription.eventTypes.length > 4 && (
                            <Badge variant="outline" className="text-xs">
                              +{subscription.eventTypes.length - 4} more
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-sm">
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded truncate max-w-md">
                            {subscription.targetUrl}
                          </code>
                        </div>

                        {subscription.description && (
                          <p className="text-sm text-muted-foreground">
                            {subscription.description}
                          </p>
                        )}

                        {subscription.filterExpression && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Filter className="h-3 w-3" />
                            <span>Filter: {subscription.filterExpression}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTest(subscription.id)}
                          disabled={testingId === subscription.id}
                          title="Send test event"
                        >
                          {testingId === subscription.id ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Zap className="h-4 w-4" />
                          )}
                        </Button>

                        <Button
                          variant={
                            subscription.status === 'active'
                              ? 'secondary'
                              : 'default'
                          }
                          size="sm"
                          onClick={() => handleTogglePause(subscription)}
                          title={
                            subscription.status === 'active'
                              ? 'Pause'
                              : 'Resume'
                          }
                        >
                          {subscription.status === 'active' ? (
                            <PauseCircle className="h-4 w-4" />
                          ) : (
                            <PlayCircle className="h-4 w-4" />
                          )}
                        </Button>

                        {deleteConfirmId === subscription.id ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDelete(subscription.id)}
                            >
                              Confirm
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDeleteConfirmId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteConfirmId(subscription.id)}
                            title="Delete subscription"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Delivery Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t">
                      <DeliveryStatCard
                        icon={<Activity className="h-4 w-4 text-blue-600" />}
                        label="Total Deliveries"
                        value={String(
                          subscription.deliveryStats.totalDeliveries,
                        )}
                        colorClass="bg-blue-100 text-blue-600"
                      />
                      <DeliveryStatCard
                        icon={
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        }
                        label="Success Rate"
                        value={`${(subscription.deliveryStats.successRate * 100).toFixed(1)}%`}
                        colorClass="bg-green-100 text-green-600"
                      />
                      <DeliveryStatCard
                        icon={
                          subscription.deliveryStats.avgLatencyMs > 1000 ? (
                            <Clock className="h-4 w-4 text-amber-600" />
                          ) : (
                            <Zap className="h-4 w-4 text-purple-600" />
                          )
                        }
                        label="Avg Latency"
                        value={formatLatency(
                          subscription.deliveryStats.avgLatencyMs,
                        )}
                        colorClass={
                          subscription.deliveryStats.avgLatencyMs > 1000
                            ? 'bg-amber-100 text-amber-600'
                            : 'bg-purple-100 text-purple-600'
                        }
                      />
                      <DeliveryStatCard
                        icon={
                          subscription.deliveryStats.failedDeliveries > 0 ? (
                            <AlertTriangle className="h-4 w-4 text-red-600" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          )
                        }
                        label="Failed"
                        value={String(
                          subscription.deliveryStats.failedDeliveries,
                        )}
                        colorClass={
                          subscription.deliveryStats.failedDeliveries > 0
                            ? 'bg-red-100 text-red-600'
                            : 'bg-green-100 text-green-600'
                        }
                      />
                    </div>

                    {subscription.deliveryStats.lastDeliveryAt && (
                      <p className="text-xs text-muted-foreground">
                        Last delivery:{' '}
                        {new Date(
                          subscription.deliveryStats.lastDeliveryAt,
                        ).toLocaleString()}
                      </p>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
