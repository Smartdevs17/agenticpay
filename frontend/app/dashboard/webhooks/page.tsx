'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { WebhookSecret, WebhookEvent, WebhookAnalytics } from '@/lib/api';
import { Key, RotateCcw, Trash2, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, BarChart3, Send } from 'lucide-react';

export default function DashboardWebhooksPage() {
  const [secrets, setSecrets] = useState<WebhookSecret[]>([]);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [analytics, setAnalytics] = useState<WebhookAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [testEventType, setTestEventType] = useState<string>('payment.completed');
  const [testMerchantId, setTestMerchantId] = useState<string>('');

  const loadData = async () => {
    try {
      setLoading(true);
      const [secretsResponse, eventsResponse, analyticsData] = await Promise.all([
        api.webhooks.listSecrets(),
        api.webhooks.listEvents(50),
        api.webhooks.getAnalytics(),
      ]);
      setSecrets(secretsResponse.secrets);
      setEvents(eventsResponse.events);
      setAnalytics(analyticsData);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load webhook data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateSecret = async (formData: FormData) => {
    try {
      const payload = {
        provider: formData.get('provider') as string,
        secret: formData.get('secret') as string,
        expiresAt: formData.get('expiresAt') as string || undefined,
      };

      await api.webhooks.createSecret(payload);
      toast.success('Webhook secret created successfully');
      setCreateDialogOpen(false);
      loadData();
    } catch (error) {
      console.error(error);
      toast.error('Failed to create webhook secret');
    }
  };

  const handleRotateSecret = async (formData: FormData) => {
    try {
      const payload = {
        newSecret: formData.get('newSecret') as string,
        gracePeriodHours: parseInt(formData.get('gracePeriodHours') as string) || 24,
      };

      await api.webhooks.rotateSecret(selectedProvider, payload);
      toast.success('Webhook secret rotated successfully');
      setRotateDialogOpen(false);
      setSelectedProvider('');
      loadData();
    } catch (error) {
      console.error(error);
      toast.error('Failed to rotate webhook secret');
    }
  };

  const handleDeleteSecret = async (secretId: string) => {
    if (!confirm('Are you sure you want to delete this webhook secret?')) {
      return;
    }

    try {
      await api.webhooks.deleteSecret(secretId);
      toast.success('Webhook secret deleted successfully');
      loadData();
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete webhook secret');
    }
  };

  const handleRetryEvent = async (eventId: string) => {
    try {
      await api.webhooks.retryEvent(eventId);
      toast.success('Webhook event retry initiated');
      loadData();
    } catch (error) {
      console.error(error);
      toast.error('Failed to retry webhook event');
    }
  };

  const handleMarkProcessed = async (eventId: string) => {
    try {
      await api.webhooks.markEventProcessed(eventId);
      toast.success('Webhook event marked as processed');
      loadData();
    } catch (error) {
      console.error(error);
      toast.error('Failed to mark event as processed');
    }
  };

  const handleSendTest = async () => {
    if (!testMerchantId.trim()) {
      toast.error('Please enter a merchant ID');
      return;
    }
    try {
      const result = await api.webhooks.sendTest({ merchantId: testMerchantId, eventType: testEventType });
      if (result.success) {
        toast.success(`Test webhook delivered (HTTP ${result.statusCode})`);
      } else {
        toast.error(`Test failed: ${result.error ?? 'Unknown error'}`);
      }
      setTestDialogOpen(false);
      loadData();
    } catch (error) {
      console.error(error);
      toast.error('Failed to send test webhook');
    }
  };

  const getStatusBadge = (event: WebhookEvent) => {
    if (event.processed) {
      return <Badge variant="default" className="bg-green-100 text-green-800"><CheckCircle className="h-3 w-3 mr-1" />Processed</Badge>;
    }
    if (event.verified && event.retryCount > 0) {
      return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800"><RefreshCw className="h-3 w-3 mr-1" />Retrying</Badge>;
    }
    if (!event.verified) {
      return <Badge variant="destructive" className="bg-red-100 text-red-800"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
    }
    return <Badge variant="outline" className="bg-blue-100 text-blue-800"><Clock className="h-3 w-3 mr-1" />Queued</Badge>;
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case 'stripe': return 'bg-purple-100 text-purple-800';
      case 'paypal': return 'bg-blue-100 text-blue-800';
      case 'github': return 'bg-gray-100 text-gray-800';
      case 'custom': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return <div className="p-8 text-center">Loading webhook management...</div>;
  }

  return (
    <div className="space-y-8 pb-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Webhook Management</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage webhook secrets, monitor events, and handle failed deliveries.
        </p>
      </div>

      {/* Secrets Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Webhook Secrets</CardTitle>
            <div className="flex gap-2">
              <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Send className="h-4 w-4 mr-2" />
                    Send Test
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Send Test Webhook</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="testMerchantId">Merchant ID</Label>
                      <Input
                        id="testMerchantId"
                        value={testMerchantId}
                        onChange={(e) => setTestMerchantId(e.target.value)}
                        placeholder="Enter merchant ID"
                      />
                    </div>
                    <div>
                      <Label htmlFor="testEventType">Event Type</Label>
                      <Select value={testEventType} onValueChange={setTestEventType}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="payment.completed">Payment Completed</SelectItem>
                          <SelectItem value="payment.failed">Payment Failed</SelectItem>
                          <SelectItem value="payment.disputed">Payment Disputed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setTestDialogOpen(false)}>Cancel</Button>
                      <Button onClick={handleSendTest}>Send Test</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Key className="h-4 w-4 mr-2" />
                    Add Secret
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Webhook Secret</DialogTitle>
                  </DialogHeader>
                  <form action={handleCreateSecret} className="space-y-4">
                    <div>
                      <Label htmlFor="provider">Provider</Label>
                      <Select name="provider" required>
                        <SelectTrigger>
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="stripe">Stripe</SelectItem>
                          <SelectItem value="paypal">PayPal</SelectItem>
                          <SelectItem value="github">GitHub</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="secret">Secret Key</Label>
                      <Input
                        id="secret"
                        name="secret"
                        type="password"
                        placeholder="Enter webhook secret"
                        required
                        minLength={32}
                      />
                    </div>
                    <div>
                      <Label htmlFor="expiresAt">Expires At (optional)</Label>
                      <Input
                        id="expiresAt"
                        name="expiresAt"
                        type="datetime-local"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit">Create Secret</Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {secrets.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No webhook secrets configured</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {secrets.map((secret) => (
                  <TableRow key={secret.id}>
                    <TableCell>
                      <Badge className={getProviderColor(secret.provider)}>
                        {secret.provider}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={secret.isActive ? "default" : "secondary"}>
                        {secret.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(secret.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {secret.lastUsedAt ? new Date(secret.lastUsedAt).toLocaleDateString() : 'Never'}
                    </TableCell>
                    <TableCell>
                      {secret.expiresAt ? new Date(secret.expiresAt).toLocaleDateString() : 'Never'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedProvider(secret.provider);
                            setRotateDialogOpen(true);
                          }}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteSecret(secret.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Events Monitoring */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Webhook Events</CardTitle>
            <Button variant="outline" onClick={loadData}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No webhook events yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Retries</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <Badge className={getProviderColor(event.provider)}>
                        {event.provider}
                      </Badge>
                    </TableCell>
                    <TableCell>{event.eventType}</TableCell>
                    <TableCell>{getStatusBadge(event)}</TableCell>
                    <TableCell>{new Date(event.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{event.retryCount}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {!event.processed && event.verified && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRetryEvent(event.id)}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                        {!event.processed && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleMarkProcessed(event.id)}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delivery Analytics */}
      {analytics && analytics.totalDeliveries > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Delivery Analytics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                <div className="text-2xl font-bold text-green-700 dark:text-green-300">{analytics.successRate}%</div>
                <div className="text-sm text-green-600 dark:text-green-400">Success Rate</div>
              </div>
              <div className="text-center p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{analytics.avgLatencyMs}ms</div>
                <div className="text-sm text-blue-600 dark:text-blue-400">Avg Latency</div>
              </div>
              <div className="text-center p-4 bg-purple-50 dark:bg-purple-950 rounded-lg">
                <div className="text-2xl font-bold text-purple-700 dark:text-purple-300">{analytics.delivered}</div>
                <div className="text-sm text-purple-600 dark:text-purple-400">Delivered</div>
              </div>
              <div className="text-center p-4 bg-orange-50 dark:bg-orange-950 rounded-lg">
                <div className="text-2xl font-bold text-orange-700 dark:text-orange-300">{analytics.avgPayloadSizeBytes}B</div>
                <div className="text-sm text-orange-600 dark:text-orange-400">Avg Payload Size</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center text-sm">
              <div>
                <span className="font-medium">Pending:</span> {analytics.pending}
              </div>
              <div>
                <span className="font-medium">Failed:</span> {analytics.failed}
              </div>
              <div>
                <span className="font-medium">Dead Letter:</span> {analytics.deadLetter}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rotate Secret Dialog */}
      <Dialog open={rotateDialogOpen} onOpenChange={setRotateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate Webhook Secret</DialogTitle>
          </DialogHeader>
          <form action={handleRotateSecret} className="space-y-4">
            <div>
              <Label htmlFor="newSecret">New Secret Key</Label>
              <Input
                id="newSecret"
                name="newSecret"
                type="password"
                placeholder="Enter new webhook secret"
                required
                minLength={32}
              />
            </div>
            <div>
              <Label htmlFor="gracePeriodHours">Grace Period (hours)</Label>
              <Input
                id="gracePeriodHours"
                name="gracePeriodHours"
                type="number"
                defaultValue="24"
                min="1"
                max="168"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRotateDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Rotate Secret</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}