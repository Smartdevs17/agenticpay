export abstract class BaseProvider {
  abstract readonly name: string;
  abstract getRate(base: string, target: string): Promise<number>;
}

export class ChainlinkProvider extends BaseProvider {
  name = 'chainlink';
  async getRate(base: string, target: string): Promise<number> {
    // Mock Chainlink Oracle Call
    return 1000 + (Math.random() * 10 - 5);
  }
}

export class CoinGeckoProvider extends BaseProvider {
  name = 'coingecko';
  async getRate(base: string, target: string): Promise<number> {
    // Mock CoinGecko API Call
    return 1000 + (Math.random() * 12 - 6);
  }
}

export class BinanceProvider extends BaseProvider {
  name = 'binance';
  async getRate(base: string, target: string): Promise<number> {
    // Mock Binance API Call
    return 1000 + (Math.random() * 8 - 4);
  }
}
