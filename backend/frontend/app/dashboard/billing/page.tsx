'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AlertCircle, CheckCircle, CreditCard, TrendingUp, Zap } from 'lucide-react';
import { api } from '@/lib/api';

interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  currency: string;
  billingInterval: 'monthly' | 'yearly';
  features: string[];
  usageLimits: Record<string, number>;
  meteredPricing: Array<{
    metricType: string;
    unitPrice: number;
    includedUnits: number;
  }>;
}

interface Subscription {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  plan: SubscriptionPlan;
  currentPeriodUsage?: Array<{
    metricType: string;
    totalQuantity: number;
  }>;
}

interface UsageSummary {
  subscription: {
    id: string;
    planName: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  };
  usage: Array<{
    metricType: string;
    totalUsage: number;
    limit: number;
    percentage: number;
    remaining: number;
  }>;
}

interface Invoice {
  id: string;
  amount: number;
  currency: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  paidAt?: string;
}

export default function BillingPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedSubscription, setSelectedSubscription] = useState<string | null>(null);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  useEffect(() => {
    if (selectedSubscription) {
      fetchUsageSummary(selectedSubscription);
      fetchInvoices(selectedSubscription);
    }
  }, [selectedSubscription]);

  const fetchSubscriptions = async () => {
    try {
      setLoading(true);
      const response = await api.get('/api/v1/subscriptions');
      const data = response.data;
      setSubscriptions(data.data || []);
      if (data.data && data.data.length > 0) {
        setSelectedSubscription(data.data[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch subscriptions:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsageSummary = async (subscriptionId: string) => {
    try {
      const response = await api.get(`/api/v1/subscriptions/${subscriptionId}/usage/summary`);
      setUsageSummary(response.data.data);
    } catch (error) {
      console.error('Failed to fetch usage summary:', error);
    }
  };

  const fetchInvoices = async (subscriptionId: string) => {
    try {
      const response = await api.get(`/api/v1/subscriptions/${subscriptionId}/invoices`);
      setInvoices(response.data.data || []);
    } catch (error) {
      console.error('Failed to fetch invoices:', error);
    }
  };

  const handleCancelSubscription = async (subscriptionId: string) => {
    if (!confirm('Are you sure you want to cancel your subscription?')) {
      return;
    }

    try {
      await api.patch(`/api/v1/subscriptions/${subscriptionId}`, {
        cancelAtPeriodEnd: true,
      });
      fetchSubscriptions();
      alert('Subscription will be cancelled at the end of the current period');
    } catch (error) {
      console.error('Failed to cancel subscription:', error);
      alert('Failed to cancel subscription');
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      active: { label: 'Active', variant: 'default' as const, icon: CheckCircle },
      trialing: { label: 'Trial', variant: 'secondary' as const, icon: Zap },
      past_due: { label: 'Past Due', variant: 'destructive' as const, icon: AlertCircle },
      canceled: { label: 'Cancelled', variant: 'outline' as const, icon: AlertCircle },
      unpaid: { label: 'Unpaid', variant: 'destructive' as const, icon: AlertCircle },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.active;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
    );
  };

  const formatMetricType = (metricType: string) => {
    return metricType
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  const activeSubscription = subscriptions.find(s => s.id === selectedSubscription);

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Billing & Subscriptions</h1>
          <p className="text-muted-foreground">
            Manage your subscription plans and usage
          </p>
        </div>
        <Button>
          <CreditCard className="w-4 h-4 mr-2" />
          Upgrade Plan
        </Button>
      </div>

      {subscriptions.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-4">
              <CreditCard className="w-16 h-16 mx-auto text-muted-foreground" />
              <h3 className="text-xl font-semibold">No Active Subscription</h3>
              <p className="text-muted-foreground">
                Choose a plan to get started with AgenticPay
              </p>
              <Button>View Plans</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Current Plan Overview */}
          {activeSubscription && (
            <Card>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-2xl">{activeSubscription.plan.name}</CardTitle>
                    <CardDescription>{activeSubscription.plan.description}</CardDescription>
                  </div>
                  {getStatusBadge(activeSubscription.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Price</p>
                    <p className="text-2xl font-bold">
                      {formatCurrency(
                        activeSubscription.plan.basePrice,
                        activeSubscription.plan.currency
                      )}
                      <span className="text-sm font-normal text-muted-foreground">
                        /{activeSubscription.plan.billingInterval}
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Current Period</p>
                    <p className="text-sm font-medium">
                      {formatDate(activeSubscription.currentPeriodStart)} -{' '}
                      {formatDate(activeSubscription.currentPeriodEnd)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Renewal</p>
                    <p className="text-sm font-medium">
                      {activeSubscription.cancelAtPeriodEnd
                        ? 'Cancelled at period end'
                        : `Auto-renews on ${formatDate(activeSubscription.currentPeriodEnd)}`}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => handleCancelSubscription(activeSubscription.id)}>
                    Cancel Subscription
                  </Button>
                  <Button variant="outline">Change Plan</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Usage & Invoices Tabs */}
          <Tabs defaultValue="usage" className="space-y-4">
            <TabsList>
              <TabsTrigger value="usage">Usage Metrics</TabsTrigger>
              <TabsTrigger value="invoices">Invoices</TabsTrigger>
              <TabsTrigger value="features">Features</TabsTrigger>
            </TabsList>

            <TabsContent value="usage" className="space-y-4">
              {usageSummary && usageSummary.usage.length > 0 ? (
                <div className="grid gap-4">
                  {usageSummary.usage.map((metric) => (
                    <Card key={metric.metricType}>
                      <CardHeader>
                        <div className="flex justify-between items-start">
                          <div>
                            <CardTitle className="text-lg">
                              {formatMetricType(metric.metricType)}
                            </CardTitle>
                            <CardDescription>
                              {metric.totalUsage.toLocaleString()} /{' '}
                              {metric.limit.toLocaleString()} units
                            </CardDescription>
                          </div>
                          <Badge variant={metric.percentage >= 100 ? 'destructive' : metric.percentage >= 80 ? 'default' : 'secondary'}>
                            {metric.percentage.toFixed(1)}%
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <Progress value={Math.min(metric.percentage, 100)} className="h-2" />
                        <p className="text-sm text-muted-foreground mt-2">
                          {metric.remaining > 0
                            ? `${metric.remaining.toLocaleString()} units remaining`
                            : 'Limit exceeded'}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
                    <TrendingUp className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">
                      No usage data for the current period
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="invoices">
              <Card>
                <CardHeader>
                  <CardTitle>Invoice History</CardTitle>
                  <CardDescription>Your billing history and invoices</CardDescription>
                </CardHeader>
                <CardContent>
                  {invoices.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Period</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead>Paid</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoices.map((invoice) => (
                          <TableRow key={invoice.id}>
                            <TableCell>
                              {formatDate(invoice.periodStart)} - {formatDate(invoice.periodEnd)}
                            </TableCell>
                            <TableCell className="font-medium">
                              {formatCurrency(invoice.amount, invoice.currency)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={invoice.status === 'paid' ? 'default' : 'destructive'}>
                                {invoice.status}
                              </Badge>
                            </TableCell>
                            <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                            <TableCell>
                              {invoice.paidAt ? formatDate(invoice.paidAt) : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm">
                                Download
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="py-12 text-center">
                      <p className="text-muted-foreground">No invoices yet</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="features">
              {activeSubscription && (
                <Card>
                  <CardHeader>
                    <CardTitle>Plan Features</CardTitle>
                    <CardDescription>
                      Features included in your {activeSubscription.plan.name} plan
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {activeSubscription.plan.features?.map((feature, index) => (
                        <li key={index} className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>

                    {activeSubscription.plan.meteredPricing?.length > 0 && (
                      <div className="mt-6">
                        <h4 className="font-semibold mb-3">Metered Pricing</h4>
                        <div className="space-y-2">
                          {activeSubscription.plan.meteredPricing.map((pricing) => (
                            <div
                              key={pricing.metricType}
                              className="flex justify-between items-center p-3 bg-muted rounded-lg"
                            >
                              <span>{formatMetricType(pricing.metricType)}</span>
                              <span className="text-sm text-muted-foreground">
                                {formatCurrency(pricing.unitPrice, activeSubscription.plan.currency)}{' '}
                                per unit (first {pricing.includedUnits.toLocaleString()} included)
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
