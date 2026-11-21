import { BaseProvider, ChainlinkProvider, CoinGeckoProvider, BinanceProvider } from './providers/base-provider';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';

const prisma = new PrismaClient();

const redis = createClient({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});

redis.connect().catch(console.error);

export class RateAggregator {
  private providers: BaseProvider[] = [
    new ChainlinkProvider(),
    new CoinGeckoProvider(),
    new BinanceProvider()
  ];

  async getAggregatedRate(base: string, target: string, isFiat: boolean = false): Promise<number> {
    const cacheKey = `fx_rate:${base}:${target}`;
    
    // Try Fetching Rates from all providers
    const ratePromises = this.providers.map(p => p.getRate(base, target).catch(() => null));
    const rawRates = await Promise.all(ratePromises);
    const validRates = rawRates.filter(r => r !== null) as number[];

    if (validRates.length === 0) {
      // Fallback: Check cache
      const cached = await redis.zRange(cacheKey, -1, -1);
      if (cached && cached.length > 0) {
        const [, rateStr] = cached[0].split(':');
        return parseFloat(rateStr);
      }
      throw new Error(`Failed to fetch rate for ${base}/${target} from all providers and no cache available.`);
    }

    // Outlier Rejection & Median Calculation
    const aggregatedRate = this.calculateMedianWithOutlierRejection(validRates);

    // Save to Cache
    const ttl = isFiat ? 60 : 30;
    const timestamp = Date.now();
    await redis.zAdd(cacheKey, [{ score: timestamp, value: `${timestamp}:${aggregatedRate}` }]);
    await redis.expire(cacheKey, ttl);

    // Persist to DB asynchronously for historical data
    this.persistRateToDb(base, target, aggregatedRate).catch(console.error);

    return aggregatedRate;
  }

  private calculateMedianWithOutlierRejection(rates: number[]): number {
    if (rates.length === 1) return rates[0];
    if (rates.length === 2) return (rates[0] + rates[1]) / 2;

    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const stdDev = Math.sqrt(rates.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / rates.length);

    // 2-sigma rejection
    const validRates = rates.filter(r => Math.abs(r - mean) <= 2 * stdDev);
    
    if (validRates.length === 0) {
      return mean; // Fallback to mean if all are technically outliers
    }

    validRates.sort((a, b) => a - b);
    const mid = Math.floor(validRates.length / 2);
    if (validRates.length % 2 === 0) {
      return (validRates[mid - 1] + validRates[mid]) / 2;
    }
    return validRates[mid];
  }

  private async persistRateToDb(base: string, target: string, rate: number) {
    await prisma.fxRate.create({
      data: {
        baseCurrency: base,
        targetCurrency: target,
        rate: rate,
        provider: 'aggregator'
      }
    });
  }
}
