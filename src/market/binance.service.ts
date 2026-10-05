import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { SUPPORTED_ASSETS } from '../config.js';

export interface PriceTick {
  symbol: string;
  price: number;
  timestamp: number;
  change24h?: number;
  high24h?: number;
  low24h?: number;
}

export class BinancePriceService extends EventEmitter {
  private ws: WebSocket | null = null;
  private prices: Map<string, PriceTick> = new Map();
  private isReconnecting = false;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    // Initialize default prices from fallback
    SUPPORTED_ASSETS.forEach((asset) => {
      this.prices.set(asset.symbol, {
        symbol: asset.symbol,
        price: asset.symbol === 'BTCUSDT' ? 68000 : asset.symbol === 'ETHUSDT' ? 3500 : asset.symbol === 'SOLUSDT' ? 180 : 600,
        timestamp: Date.now(),
      });
    });
  }

  public start() {
    this.connect();
    // Periodically fetch REST fallback to verify accuracy
    setInterval(() => this.fetchRestFallback(), 30000);
  }

  private connect() {
    const streams = SUPPORTED_ASSETS.map((a) => `${a.symbol.toLowerCase()}@ticker`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    console.log(`🔌 Connecting to Binance WebSocket stream: ${url}`);
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('✅ Binance WebSocket connected successfully');
      this.isReconnecting = false;
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
        const payload = JSON.parse(data.toString());
        if (payload.data && payload.data.s && payload.data.c) {
          const symbol = payload.data.s;
          const price = parseFloat(payload.data.c);
          const change24h = parseFloat(payload.data.P || '0');
          const high24h = parseFloat(payload.data.h || '0');
          const low24h = parseFloat(payload.data.l || '0');

          const tick: PriceTick = {
            symbol,
            price,
            timestamp: payload.data.E || Date.now(),
            change24h,
            high24h,
            low24h,
          };

          this.prices.set(symbol, tick);
          this.emit('price', tick);
        }
      } catch (err) {
        // silent parse error
      }
    });

    this.ws.on('error', (err) => {
      console.warn('⚠️ Binance WebSocket error:', err.message);
    });

    this.ws.on('close', () => {
      console.warn('⚠️ Binance WebSocket disconnected. Reconnecting in 3s...');
      if (!this.isReconnecting) {
        this.isReconnecting = true;
        setTimeout(() => this.connect(), 3000);
      }
    });
  }

  public getPrice(symbol: string): PriceTick {
    return (
      this.prices.get(symbol.toUpperCase()) || {
        symbol: symbol.toUpperCase(),
        price: 0,
        timestamp: Date.now(),
      }
    );
  }

  public getAllPrices(): PriceTick[] {
    return Array.from(this.prices.values());
  }

  private async fetchRestFallback() {
    try {
      for (const asset of SUPPORTED_ASSETS) {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${asset.symbol}`);
        if (res.ok) {
          const data = (await res.json()) as any;
          if (data && data.lastPrice) {
            const current = this.prices.get(asset.symbol);
            this.prices.set(asset.symbol, {
              symbol: asset.symbol,
              price: parseFloat(data.lastPrice),
              timestamp: Date.now(),
              change24h: parseFloat(data.priceChangePercent || '0'),
              high24h: parseFloat(data.highPrice || '0'),
              low24h: parseFloat(data.lowPrice || '0'),
            });
          }
        }
      }
    } catch (e) {
      // ignore network errors
    }
  }
}

export const binancePriceService = new BinancePriceService();
