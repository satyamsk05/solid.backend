import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../database/prisma.js';

export function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export interface UserWallet {
  userId: string;
  balance: number;
  lockedBalance: number;
}

export interface WalletTransaction {
  id: string;
  userId: string;
  type: 'deposit' | 'withdraw' | 'bet_place' | 'bet_won' | 'bet_lost' | 'refund' | 'bonus';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceId?: string;
  description?: string;
  createdAt: number;
}

export class WalletService {
  // In-memory cache for fast lookups & fallbacks
  private wallets: Map<string, UserWallet> = new Map();
  private transactions: WalletTransaction[] = [];

  constructor() {}

  public async getWallet(userId: string): Promise<UserWallet> {
    if (!this.wallets.has(userId)) {
      let realBalance = 1000.0;
      let realLocked = 0.0;

      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user) {
          realBalance = round2(Number(user.balance));
          realLocked = round2(Number(user.lockedBalance));
        }
      } catch (e) {
        // fallback
      }

      const newWallet: UserWallet = {
        userId,
        balance: realBalance,
        lockedBalance: realLocked,
      };
      this.wallets.set(userId, newWallet);
      return newWallet;
    }
    return this.wallets.get(userId)!;
  }

  public async deposit(userId: string, amount: number, referenceId?: string): Promise<UserWallet> {
    if (amount <= 0) throw new Error('Deposit amount must be positive');
    const safeAmount = round2(amount);
    const wallet = await this.getWallet(userId);
    const before = wallet.balance;
    wallet.balance = round2(wallet.balance + safeAmount);
    const after = wallet.balance;

    const tx: WalletTransaction = {
      id: uuidv4(),
      userId,
      type: 'deposit',
      amount: safeAmount,
      balanceBefore: before,
      balanceAfter: after,
      referenceId,
      description: `INR Deposit of ₹${safeAmount.toFixed(2)}`,
      createdAt: Date.now(),
    };
    this.transactions.unshift(tx);

    prisma.user
      .update({
        where: { id: userId },
        data: { balance: wallet.balance },
      })
      .catch(() => {});

    prisma.transaction
      .create({
        data: {
          id: tx.id,
          userId,
          type: tx.type,
          amount: tx.amount,
          balanceBefore: tx.balanceBefore,
          balanceAfter: tx.balanceAfter,
          referenceId: tx.referenceId,
          description: tx.description,
        },
      })
      .catch(() => {});

    return wallet;
  }

  public async withdraw(userId: string, amount: number): Promise<UserWallet> {
    if (amount <= 0) throw new Error('Withdrawal amount must be positive');
    const safeAmount = round2(amount);
    const wallet = await this.getWallet(userId);
    if (wallet.balance < safeAmount) {
      throw new Error(`Insufficient available balance (Available: ₹${wallet.balance.toFixed(2)})`);
    }

    const before = wallet.balance;
    wallet.balance = round2(wallet.balance - safeAmount);
    const after = wallet.balance;

    const tx: WalletTransaction = {
      id: uuidv4(),
      userId,
      type: 'withdraw',
      amount: safeAmount,
      balanceBefore: before,
      balanceAfter: after,
      description: `INR Withdrawal of ₹${safeAmount.toFixed(2)}`,
      createdAt: Date.now(),
    };
    this.transactions.unshift(tx);

    prisma.user
      .update({
        where: { id: userId },
        data: { balance: wallet.balance },
      })
      .catch(() => {});

    return wallet;
  }

  public async lockFundsForBet(userId: string, amount: number, roundId: string): Promise<UserWallet> {
    const safeAmount = round2(amount);
    const wallet = await this.getWallet(userId);

    if (wallet.balance < safeAmount) {
      throw new Error(`Insufficient balance (Available: ₹${wallet.balance.toFixed(2)}, Required: ₹${safeAmount.toFixed(2)})`);
    }

    const before = wallet.balance;
    wallet.balance = round2(wallet.balance - safeAmount);
    wallet.lockedBalance = round2(wallet.lockedBalance + safeAmount);

    const tx: WalletTransaction = {
      id: uuidv4(),
      userId,
      type: 'bet_place',
      amount: safeAmount,
      balanceBefore: before,
      balanceAfter: wallet.balance,
      referenceId: roundId,
      description: `Bet placed: ₹${safeAmount.toFixed(2)} locked`,
      createdAt: Date.now(),
    };
    this.transactions.unshift(tx);

    prisma.user
      .update({
        where: { id: userId },
        data: {
          balance: wallet.balance,
          lockedBalance: wallet.lockedBalance,
        },
      })
      .catch(() => {});

    return wallet;
  }

  public async settleWonBet(userId: string, betAmount: number, payoutAmount: number, roundId: string): Promise<UserWallet> {
    const safeBet = round2(betAmount);
    const safePayout = round2(payoutAmount);
    const wallet = await this.getWallet(userId);

    wallet.lockedBalance = round2(Math.max(0, wallet.lockedBalance - safeBet));
    const before = wallet.balance;
    wallet.balance = round2(wallet.balance + safePayout);

    const tx: WalletTransaction = {
      id: uuidv4(),
      userId,
      type: 'bet_won',
      amount: safePayout,
      balanceBefore: before,
      balanceAfter: wallet.balance,
      referenceId: roundId,
      description: `Bet won! Payout ₹${safePayout.toFixed(2)} credited`,
      createdAt: Date.now(),
    };
    this.transactions.unshift(tx);

    prisma.user
      .update({
        where: { id: userId },
        data: {
          balance: wallet.balance,
          lockedBalance: wallet.lockedBalance,
        },
      })
      .catch(() => {});

    return wallet;
  }

  public async settleLostBet(userId: string, betAmount: number, roundId: string): Promise<UserWallet> {
    const safeBet = round2(betAmount);
    const wallet = await this.getWallet(userId);

    wallet.lockedBalance = round2(Math.max(0, wallet.lockedBalance - safeBet));
    const tx: WalletTransaction = {
      id: uuidv4(),
      userId,
      type: 'bet_lost',
      amount: safeBet,
      balanceBefore: wallet.balance,
      balanceAfter: wallet.balance,
      referenceId: roundId,
      description: `Bet lost: ₹${safeBet.toFixed(2)} deducted`,
      createdAt: Date.now(),
    };
    this.transactions.unshift(tx);

    prisma.user
      .update({
        where: { id: userId },
        data: { lockedBalance: wallet.lockedBalance },
      })
      .catch(() => {});

    return wallet;
  }

  public async settleDrawBet(userId: string, betAmount: number, roundId: string): Promise<UserWallet> {
    const safeBet = round2(betAmount);
    const wallet = await this.getWallet(userId);

    wallet.lockedBalance = round2(Math.max(0, wallet.lockedBalance - safeBet));
    const before = wallet.balance;
    wallet.balance = round2(wallet.balance + safeBet);

    const tx: WalletTransaction = {
      id: uuidv4(),
      userId,
      type: 'refund',
      amount: safeBet,
      balanceBefore: before,
      balanceAfter: wallet.balance,
      referenceId: roundId,
      description: `Round Draw: ₹${safeBet.toFixed(2)} refunded`,
      createdAt: Date.now(),
    };
    this.transactions.unshift(tx);

    prisma.user
      .update({
        where: { id: userId },
        data: {
          balance: wallet.balance,
          lockedBalance: wallet.lockedBalance,
        },
      })
      .catch(() => {});

    return wallet;
  }

  public getTransactions(userId: string, limit = 50): WalletTransaction[] {
    return this.transactions.filter((t) => t.userId === userId).slice(0, limit);
  }
}

export const walletService = new WalletService();
