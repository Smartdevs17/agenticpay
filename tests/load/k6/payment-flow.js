import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:3000';

export const options = {
  scenarios: {
    payment_reads: {
      executor: 'ramping-arrival-rate',
      startRate: Number(__ENV.START_RATE || 5),
      timeUnit: '1s',
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 20),
      maxVUs: Number(__ENV.MAX_VUS || 100),
      stages: [
        { target: Number(__ENV.TARGET_RATE || 25), duration: __ENV.RAMP_DURATION || '30s' },
        { target: Number(__ENV.TARGET_RATE || 25), duration: __ENV.HOLD_DURATION || '1m' },
        { target: 0, duration: '15s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<750', 'p(99)<1500'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const health = http.get(`${baseUrl}/health`);
  check(health, { 'health status is 2xx': (res) => res.status >= 200 && res.status < 300 });

  const strategies = http.get(`${baseUrl}/api/v1/payment-strategies`);
  check(strategies, {
    'payment strategies status is 2xx': (res) => res.status >= 200 && res.status < 300,
    'payment strategies response is bounded': (res) => res.body.length < 2_000_000,
  });

  sleep(0.1);
}
