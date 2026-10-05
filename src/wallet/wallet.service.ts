import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../database/prisma.js';

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
      // Fetch or create user in DB
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user) {
          const w: UserWallet = {
            userId: user.id,
            balance: Number(user.balance),
            lockedBalance: Number(user.lockedBalance),
          };
          this.wallets.set(userId, w);
          return w;
        }
      } catch (e) {
        // fallback
      }

      // Default new wallet with initial balance 1000 INR for real testing
      const newWallet: UserWallet = {
        userId,
        balance: 1000.0,
        lockedBalance: 0.0,
      };
      this.wallets.set(userId, newWallet);
      return newWallet;
    }
    return this.wallets.get(userId)!;
  }

  public async deposit(userId: string, amount: number, referenceId?: string): Promise<UserWallet> {
    if (amount <= 0) throw new Error('Deposit amount must be positive');
    const wallet = await this.getWallet(userId);
    const before = wallet.balance;
    wallet.balance += amount;
    const after = wallet.balance;

    const tx: WalletTransaction = {
      id: uuidv4(),
      userId,
      type: 'deposit',
      amount,
      balanceBefore: before,
      balanceAfter: after,
      referenceId,
      description: `INR Deposit of ₹${amount.toFixed(2)}`,
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
    const wallet = await this.getWallet(userId);
    if (wallet.balance < amount) {
      throw new Error('Insufficient available balance for withdrawal');
    }

    const before = wallet.balance;
    wallet.balance -= amount;
    const after = wallet.balance;

    const tx: WalletTransaction = {
      id: uuidv4(),
      userId,
      type: 'withdraw',
      amount,
      balanceBefore: before,
      balanceAfter: after,
      description: `INR Withdrawal of ₹${amount.toFixed(2)}`,
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
    const wallet = await this.getWallet(userId);
    if (wallet.balance < amount) {
      throw new Error(`Insufficient balance (Available: ₹${wallet.balance.toFixed(2)}, Required: ₹${amount.toFixed(2)})`);
    }

    const before = wallet.balance;
    wallet.balance -= amount;
    wallet.lockedBalance += amount;
    const after = wallet.balance;

    const tx: WalletTransaction = {
      id: uuidv4(),
      userId,
      type: 'bet_place',
      amount,
      balanceBefore: before,
      balanceAfter: after,
      referenceId: roundId,
      description: `Bet placed: ₹${amount.toFixed(2)} locked`,
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
    const wallet = await this.getWallet(userId);
    wallet.lockedBalance = Math.max(0, wallet.lockedBalance - betAmount);
    const before = wallet.balance;
    wallet.balance += payoutAmount;
    const after = wallet.balance;

    const tx: WalletTransaction = {
      id: uuidv4(),
      userId,
      type: 'bet_won',
      amount: payoutAmount,
      balanceBefore: before,
      balanceAfter: after,
      referenceId: roundId,
      description: `Bet won! Payout ₹${payoutAmount.toFixed(2)} credited`,
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
    const wallet = await this.getWallet(userId);
    wallet.lockedBalance = Math.max(0, wallet.lockedBalance - betAmount);

    const tx: WalletTransaction = {
      id: uuidv4(),
      userId,
      type: 'bet_lost',
      amount: betAmount,
      balanceBefore: wallet.balance,
      balanceAfter: wallet.balance,
      referenceId: roundId,
      description: `Bet lost: ₹${betAmount.toFixed(2)} deducted`,
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
    const wallet = await this.getWallet(userId);
    wallet.lockedBalance = Math.max(0, wallet.lockedBalance - betAmount);
    const before = wallet.balance;
    wallet.balance += betAmount;
    const after = wallet.balance;

    const tx: WalletTransaction = {
      id: uuidv4(),
      userId,
      type: 'refund',
      amount: betAmount,
      balanceBefore: before,
      balanceAfter: after,
      referenceId: roundId,
      description: `Round Draw: ₹${betAmount.toFixed(2)} refunded`,
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
