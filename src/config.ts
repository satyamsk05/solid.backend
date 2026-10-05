import dotenv from 'dotenv';
dotenv.config();

export interface AssetConfig {
  symbol: string;
  name: string;
  minBet: number;
  maxBet: number;
}

export const SUPPORTED_ASSETS: AssetConfig[] = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', minBet: 10, maxBet: 50000 },
  { symbol: 'ETHUSDT', name: 'Ethereum', minBet: 10, maxBet: 50000 },
  { symbol: 'SOLUSDT', name: 'Solana', minBet: 10, maxBet: 25000 },
  { symbol: 'BNBUSDT', name: 'BNB', minBet: 10, maxBet: 25000 },
];

export const SUPPORTED_TIMEFRAMES = ['1m', '3m', '5m', '15m'] as const;
export type Timeframe = (typeof SUPPORTED_TIMEFRAMES)[number];

// Duration in seconds and betting window in seconds
export const TIMEFRAME_CONFIG: Record<Timeframe, { totalSeconds: number; bettingWindowSeconds: number }> = {
  '1m': { totalSeconds: 60, bettingWindowSeconds: 45 },
  '3m': { totalSeconds: 180, bettingWindowSeconds: 120 },
  '5m': { totalSeconds: 300, bettingWindowSeconds: 180 },
  '15m': { totalSeconds: 900, bettingWindowSeconds: 600 },
};

export const CONFIG = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'super-secret-jwt-key-solidgame-2026',
  binanceWsUrl: process.env.BINANCE_WS_URL || 'wss://stream.binance.com:9443/ws',
  houseEdge: parseFloat(process.env.HOUSE_EDGE || '0.05'),
  payoutMultiplier: parseFloat(process.env.DEFAULT_PAYOUT_MULTIPLIER || '1.90'),
  logginAppKey: process.env.LOGGIN_APP_KEY || 'J2T8R6YN',
};
