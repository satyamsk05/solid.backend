import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { SUPPORTED_ASSETS, SUPPORTED_TIMEFRAMES, TIMEFRAME_CONFIG, Timeframe } from '../config.js';
import { binancePriceService } from '../market/binance.service.js';
import { prisma } from '../database/prisma.js';

export interface ActiveRound {
  id: string;
  symbol: string;
  timeframe: string;
  startTime: number;
  bettingEndTime: number;
  endTime: number;
  openPrice: number;
  closePrice: number | null;
  status: 'betting' | 'locked' | 'completed' | 'cancelled';
  result: 'up' | 'down' | 'draw' | null;
  totalUpAmount: number;
  totalDownAmount: number;
}

export class RoundService extends EventEmitter {
  private activeRounds: Map<string, ActiveRound> = new Map(); // key: `${symbol}:${timeframe}`
  private roundHistory: ActiveRound[] = [];
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  public async start() {
    console.log('🔄 Initializing Round Manager...');
    // Ensure an active round exists for every asset & timeframe
    for (const asset of SUPPORTED_ASSETS) {
      for (const tf of SUPPORTED_TIMEFRAMES) {
        this.initOrGetNextRound(asset.symbol, tf);
      }
    }

    // Tick every 500ms to monitor round lifecycles with precision
    this.checkInterval = setInterval(() => {
      this.tick();
    }, 500);
  }

  private getKey(symbol: string, timeframe: string): string {
    return `${symbol.toUpperCase()}:${timeframe}`;
  }

  public getActiveRound(symbol: string, timeframe: string): ActiveRound | null {
    return this.activeRounds.get(this.getKey(symbol, timeframe)) || null;
  }

  public getAllActiveRounds(): ActiveRound[] {
    return Array.from(this.activeRounds.values());
  }

  public getRoundHistory(symbol?: string, timeframe?: string, limit = 20): ActiveRound[] {
    let history = [...this.roundHistory];
    if (symbol) {
      history = history.filter((r) => r.symbol.toUpperCase() === symbol.toUpperCase());
    }
    if (timeframe) {
      history = history.filter((r) => r.timeframe === timeframe);
    }
    return history.slice(0, limit);
  }

  public getRoundById(roundId: string): ActiveRound | undefined {
    for (const r of this.activeRounds.values()) {
      if (r.id === roundId) return r;
    }
    return this.roundHistory.find((r) => r.id === roundId);
  }

  public updateRoundBetPool(roundId: string, direction: 'up' | 'down', amount: number) {
    for (const round of this.activeRounds.values()) {
      if (round.id === roundId) {
        if (direction === 'up') {
          round.totalUpAmount += amount;
        } else {
          round.totalDownAmount += amount;
        }
        this.emit('round_update', round);
        break;
      }
    }
  }

  private initOrGetNextRound(symbol: string, timeframe: Timeframe): ActiveRound {
    const key = this.getKey(symbol, timeframe);
    const config = TIMEFRAME_CONFIG[timeframe];
    const now = Date.now();
    const liveTick = binancePriceService.getPrice(symbol);
    const openPrice = liveTick.price;

    const newRound: ActiveRound = {
      id: uuidv4(),
      symbol,
      timeframe,
      startTime: now,
      bettingEndTime: now + config.bettingWindowSeconds * 1000,
      endTime: now + config.totalSeconds * 1000,
      openPrice,
      closePrice: null,
      status: 'betting',
      result: null,
      totalUpAmount: 0,
      totalDownAmount: 0,
    };

    this.activeRounds.set(key, newRound);

    // Sync to DB in background
    prisma.round
      .create({
        data: {
          id: newRound.id,
          symbol: newRound.symbol,
          timeframe: newRound.timeframe,
          startTime: new Date(newRound.startTime),
          bettingEndTime: new Date(newRound.bettingEndTime),
          endTime: new Date(newRound.endTime),
          openPrice: newRound.openPrice,
          status: newRound.status,
          totalUpAmount: newRound.totalUpAmount,
          totalDownAmount: newRound.totalDownAmount,
        },
      })
      .catch((e) => {
        // silent db fallback
      });

    this.emit('round_start', newRound);
    this.emit('round_update', newRound);
    return newRound;
  }

  private async tick() {
    const now = Date.now();

    for (const [key, round] of this.activeRounds.entries()) {
      // 1. Check if betting window has closed
      if (round.status === 'betting' && now >= round.bettingEndTime) {
        round.status = 'locked';
        this.emit('round_locked', round);
        this.emit('round_update', round);

        prisma.round
          .update({
            where: { id: round.id },
            data: { status: 'locked' },
          })
          .catch(() => {});
      }

      // 2. Check if round timeframe has ended
      if (now >= round.endTime && round.status !== 'completed') {
        await this.completeRound(key, round);
      }
    }
  }

  private async completeRound(key: string, round: ActiveRound) {
    const liveTick = binancePriceService.getPrice(round.symbol);
    const closePrice = liveTick.price > 0 ? liveTick.price : round.openPrice;
    round.closePrice = closePrice;
    round.status = 'completed';

    // Calculate result
    if (closePrice > round.openPrice) {
      round.result = 'up';
    } else if (closePrice < round.openPrice) {
      round.result = 'down';
    } else {
      round.result = 'draw';
    }

    console.log(
      `🏁 Round completed: ${round.symbol} [${round.timeframe}] | Open: ${round.openPrice} -> Close: ${closePrice} | Result: ${round.result.toUpperCase()}`
    );

    // Save to history
    this.roundHistory.unshift({ ...round });
    if (this.roundHistory.length > 200) {
      this.roundHistory.pop();
    }

    // Emit completed event to settle bets
    this.emit('round_completed', round);
    this.emit('round_update', round);

    // Update in DB
    prisma.round
      .update({
        where: { id: round.id },
        data: {
          closePrice: round.closePrice,
          status: 'completed',
          result: round.result,
        },
      })
      .catch(() => {});

    // Start immediate next round for this symbol & timeframe
    const [symbol, tf] = key.split(':') as [string, Timeframe];
    this.initOrGetNextRound(symbol, tf);
  }
}

export const roundService = new RoundService();
