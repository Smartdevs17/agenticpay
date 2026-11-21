import StatsD from 'hot-shots';
import { config } from '../config.js';

const statsd = new StatsD({
  host: config.datadog?.host || 'localhost',
  port: config.datadog?.port || 8125,
  protocol: 'udp4',
  maxBufferSize: 1024,
  cacheDns: true,
});

export const metrics = {
  increment: (metric: string, value: number = 1, tags: Record<string, string> = {}) => {
    const tagArray = Object.entries(tags).map(([k, v]) => `${k}:${v}`);
    statsd.increment(metric, value, tagArray);
  },

  gauge: (metric: string, value: number, tags: Record<string, string> = {}) => {
    const tagArray = Object.entries(tags).map(([k, v]) => `${k}:${v}`);
    statsd.gauge(metric, value, tagArray);
  },

  distribution: (metric: string, value: number, tags: Record<string, string> = {}) => {
    const tagArray = Object.entries(tags).map(([k, v]) => `${k}:${v}`);
    statsd.distribution(metric, value, tagArray);
  },

  histogram: (metric: string, value: number, tags: Record<string, string> = {}) => {
    const tagArray = Object.entries(tags).map(([k, v]) => `${k}:${v}`);
    statsd.histogram(metric, value, tagArray);
  },

  timing: (metric: string, value: number, tags: Record<string, string> = {}) => {
    const tagArray = Object.entries(tags).map(([k, v]) => `${k}:${v}`);
    statsd.timing(metric, value, tagArray);
  },

  close: () => {
    statsd.close();
  },
};

export default metrics;
