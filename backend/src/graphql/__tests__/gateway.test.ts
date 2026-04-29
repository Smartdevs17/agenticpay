import { beforeEach, describe, expect, it } from 'vitest';
import { graphQLRouter } from '../gateway.js';
import { Router, Request, Response } from 'express';
import { persistedQueryRegistry } from '../persisted-queries.js';
import { fiatPaymentsService } from '../../services/fiat-payments.js';
import { projectsService } from '../../services/projects.js';
import { paymentLinksService } from '../../services/payment-links.js';

describe('graphQLRouter', () => {
  const getHandler = (router: Router, method: 'get' | 'post', path: string) => {
    const layer = router.stack.find((entry) => entry.route?.path === path && entry.route?.methods?.[method]);
    if (!layer) {
      throw new Error(`Handler not found for ${method.toUpperCase()} ${path}`);
    }
    return layer.route.stack[0].handle;
  };

  beforeEach(() => {
    fiatPaymentsService.resetForTests();
    projectsService.resetForTests();
    paymentLinksService.resetForTests();
  });

  it('registers and resolves persisted query', async () => {
    const post = getHandler(graphQLRouter, 'post', '/');
    const req = {
      body: {
        query: 'mutation registerPersistedQuery($input: PersistedQueryInput!){ registerPersistedQuery(input: $input){ id registeredAt } }',
        variables: { input: { id: 'pq_test_1', query: '{ federationSdl }' } },
      },
      headers: {},
      ip: '127.0.0.1',
    } as Partial<Request>;
    const sent: Array<{ data: unknown }> = [];
    const res = {
      json: (payload: { data: unknown }) => {
        sent.push(payload);
        return payload;
      },
    } as Partial<Response>;

    await post(req as Request, res as Response, () => undefined);

    expect(persistedQueryRegistry.has('pq_test_1')).toBe(true);
    expect(sent[0].data).toBeDefined();
  });

  it('returns cursor-based payment connection', async () => {
    const account = fiatPaymentsService.createBankAccount({
      accountHolderName: 'Ops',
      bankName: 'Chase',
      accountNumberMasked: '****1234',
      routingNumber: '021000021',
      verificationMethod: 'plaid',
      countryCode: 'US',
    });
    fiatPaymentsService.createPayment({
      method: 'ach',
      bankAccountId: account.id,
      recipient: {
        name: 'Vendor',
        accountNumberMasked: '****4444',
        routingNumber: '021000021',
        bankName: 'Wells Fargo',
        countryCode: 'US',
      },
      amount: 200,
      currency: 'USD',
      isInternational: false,
    });

    const post = getHandler(graphQLRouter, 'post', '/');
    const req = {
      body: {
        query: '{ paymentsConnection(first: 1) { totalCount edges { cursor } pageInfo { hasNextPage } } }',
        variables: { first: 1 },
      },
      headers: {},
      ip: '127.0.0.1',
    } as Partial<Request>;
    let payload: any;
    const res = {
      json: (body: any) => {
        payload = body;
        return body;
      },
    } as Partial<Response>;

    await post(req as Request, res as Response, () => undefined);
    expect(payload.data.paymentsConnection.totalCount).toBe(1);
    expect(payload.data.paymentsConnection.edges).toHaveLength(1);
  });
});