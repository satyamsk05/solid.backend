import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { CONFIG } from '../config.js';
import { roundService, ActiveRound } from '../rounds/round.service.js';
import { walletService } from '../wallet/wallet.service.js';
import { prisma } from '../database/prisma.js';

export interface BetRecord {
  id: string;
  userId: string;
  roundId: string;
  direction: 'up' | 'down';
  amount: number;
  potentialPayout: number;
  status: 'pending' | 'won' | 'lost' | 'refunded' | 'cancelled';
  payoutAmount: number;
  createdAt: number;
}

export class BetService extends EventEmitter {
  private bets: Map<string, BetRecord> = new Map();

  constructor() {
    super();
    // Listen to round completion to settle all bets automatically
    roundService.on('round_completed', (round: ActiveRound) => {
      this.settleRoundBets(round);
    });
  }

  public async placeBet(
    userId: string,
    roundId: string,
    direction: 'up' | 'down',
    amount: number
  ): Promise<BetRecord> {
    if (amount <= 0) {
      throw new Error('Bet amount must be greater than 0');
    }

    const round = roundService.getRoundById(roundId);
    if (!round) {
      throw new Error('Round not found');
    }

    // Critical Rule: Never accept bets after betting_end_time or if not in 'betting' state
    const now = Date.now();
    if (round.status !== 'betting' || now >= round.bettingEndTime) {
      throw new Error('Betting window for this round is closed');
    }

    // Lock user real INR funds immediately
    await walletService.lockFundsForBet(userId, amount, roundId);

    const potentialPayout = parseFloat((amount * CONFIG.payoutMultiplier).toFixed(2));
    const bet: BetRecord = {
      id: uuidv4(),
      userId,
      roundId,
      direction,
      amount,
      potentialPayout,
      status: 'pending',
      payoutAmount: 0,
      createdAt: now,
    };

    this.bets.set(bet.id, bet);
    roundService.updateRoundBetPool(roundId, direction, amount);

    // Save to DB
    prisma.bet
      .create({
        data: {
          id: bet.id,
          userId: bet.userId,
          roundId: bet.roundId,
          direction: bet.direction,
          amount: bet.amount,
          potentialPayout: bet.potentialPayout,
          status: bet.status,
        },
      })
      .catch(() => {});

    // Notify user's active wallet balance change
    const updatedWallet = await walletService.getWallet(userId);
    this.emit('wallet_update', { userId, wallet: updatedWallet });

    return bet;
  }

  public getBetsByUser(userId: string, limit = 50): BetRecord[] {
    return Array.from(this.bets.values())
      .filter((b) => b.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  public getActiveBetsByUser(userId: string): BetRecord[] {
    return Array.from(this.bets.values()).filter((b) => b.userId === userId && b.status === 'pending');
  }

  private async settleRoundBets(round: ActiveRound) {
    const roundBets = Array.from(this.bets.values()).filter((b) => b.roundId === round.id && b.status === 'pending');

    console.log(`⚖️ Settling ${roundBets.length} bets for round ${round.id} (${round.symbol} - ${round.result})`);

    for (const bet of roundBets) {
      if (round.result === 'draw') {
        bet.status = 'refunded';
        bet.payoutAmount = bet.amount;
        await walletService.settleDrawBet(bet.userId, bet.amount, round.id);
      } else if (bet.direction === round.result) {
        bet.status = 'won';
        bet.payoutAmount = bet.potentialPayout;
        await walletService.settleWonBet(bet.userId, bet.amount, bet.potentialPayout, round.id);
      } else {
        bet.status = 'lost';
        bet.payoutAmount = 0;
        await walletService.settleLostBet(bet.userId, bet.amount, round.id);
      }

      // Update in DB
      prisma.bet
        .update({
          where: { id: bet.id },
          data: {
            status: bet.status,
            payoutAmount: bet.payoutAmount,
          },
        })
        .catch(() => {});

      // Emit specific bet result event
      this.emit('bet_result', {
        betId: bet.id,
        userId: bet.userId,
        result: bet.status,
        payoutAmount: bet.payoutAmount,
      });

      // Emit updated wallet
      const wallet = await walletService.getWallet(bet.userId);
      this.emit('wallet_update', { userId: bet.userId, wallet });
    }
  }
}

export const betService = new BetService();
