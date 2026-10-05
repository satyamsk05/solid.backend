import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { walletService } from './wallet.service.js';
import { prisma } from '../database/prisma.js';

export interface DepositRequest {
  id: string;
  userId: string;
  userPhone?: string;
  amount: number;
  utrNumber: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  updatedAt?: number;
}

export interface WithdrawalRequest {
  id: string;
  userId: string;
  userPhone?: string;
  amount: number;
  upiId: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  updatedAt?: number;
}

export class PaymentRequestService extends EventEmitter {
  private deposits: Map<string, DepositRequest> = new Map();
  private withdrawals: Map<string, WithdrawalRequest> = new Map();

  // Configurable UPI details for deposits
  public upiId: string = 'crypto.bets@upi';
  public upiName: string = 'Solidgame';

  constructor() {
    super();
  }

  // User submits manual UPI deposit with UTR
  public submitDeposit(userId: string, userPhone: string, amount: number, utrNumber: string): DepositRequest {
    if (amount <= 0) throw new Error('Deposit amount must be greater than 0');
    if (!utrNumber || utrNumber.trim().length < 6) {
      throw new Error('Valid 12-digit UTR/Ref number is required');
    }

    // Check duplicate UTR
    for (const d of this.deposits.values()) {
      if (d.utrNumber.trim().toLowerCase() === utrNumber.trim().toLowerCase()) {
        throw new Error('This UTR number has already been submitted');
      }
    }

    const req: DepositRequest = {
      id: uuidv4(),
      userId,
      userPhone,
      amount,
      utrNumber: utrNumber.trim(),
      status: 'pending',
      createdAt: Date.now(),
    };

    this.deposits.set(req.id, req);
    this.emit('new_deposit', req);
    return req;
  }

  // User submits withdrawal request to their UPI ID
  public async submitWithdrawal(userId: string, userPhone: string, amount: number, upiId: string): Promise<WithdrawalRequest> {
    if (amount <= 0) throw new Error('Withdrawal amount must be greater than 0');
    if (!upiId || !upiId.includes('@')) {
      throw new Error('Valid UPI ID is required (e.g. name@okhdfcbank)');
    }

    // Check balance
    const wallet = await walletService.getWallet(userId);
    if (wallet.balance < amount) {
      throw new Error(`Insufficient available balance (Available: ₹${wallet.balance.toFixed(2)})`);
    }

    // Lock funds immediately while withdrawal is pending
    wallet.balance -= amount;
    wallet.lockedBalance += amount;

    const req: WithdrawalRequest = {
      id: uuidv4(),
      userId,
      userPhone,
      amount,
      upiId: upiId.trim(),
      status: 'pending',
      createdAt: Date.now(),
    };

    this.withdrawals.set(req.id, req);
    this.emit('new_withdrawal', req);
    return req;
  }

  // Admin approves deposit -> credits user wallet
  public async approveDeposit(depositId: string): Promise<DepositRequest> {
    const deposit = this.deposits.get(depositId);
    if (!deposit) throw new Error('Deposit request not found');
    if (deposit.status !== 'pending') throw new Error(`Deposit already ${deposit.status}`);

    deposit.status = 'approved';
    deposit.updatedAt = Date.now();

    await walletService.deposit(deposit.userId, deposit.amount, deposit.utrNumber);
    this.emit('deposit_approved', deposit);
    return deposit;
  }

  // Admin rejects deposit
  public rejectDeposit(depositId: string, reason?: string): DepositRequest {
    const deposit = this.deposits.get(depositId);
    if (!deposit) throw new Error('Deposit request not found');
    if (deposit.status !== 'pending') throw new Error(`Deposit already ${deposit.status}`);

    deposit.status = 'rejected';
    deposit.updatedAt = Date.now();
    this.emit('deposit_rejected', deposit);
    return deposit;
  }

  // Admin approves withdrawal -> releases locked funds and deducts permanently
  public async approveWithdrawal(withdrawalId: string): Promise<WithdrawalRequest> {
    const req = this.withdrawals.get(withdrawalId);
    if (!req) throw new Error('Withdrawal request not found');
    if (req.status !== 'pending') throw new Error(`Withdrawal already ${req.status}`);

    req.status = 'approved';
    req.updatedAt = Date.now();

    const wallet = await walletService.getWallet(req.userId);
    wallet.lockedBalance = Math.max(0, wallet.lockedBalance - req.amount);

    this.emit('withdrawal_approved', req);
    return req;
  }

  // Admin rejects withdrawal -> refunds locked funds back to available balance
  public async rejectWithdrawal(withdrawalId: string): Promise<WithdrawalRequest> {
    const req = this.withdrawals.get(withdrawalId);
    if (!req) throw new Error('Withdrawal request not found');
    if (req.status !== 'pending') throw new Error(`Withdrawal already ${req.status}`);

    req.status = 'rejected';
    req.updatedAt = Date.now();

    const wallet = await walletService.getWallet(req.userId);
    wallet.lockedBalance = Math.max(0, wallet.lockedBalance - req.amount);
    wallet.balance += req.amount;

    this.emit('withdrawal_rejected', req);
    return req;
  }

  public getAllDeposits(): DepositRequest[] {
    return Array.from(this.deposits.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public getAllWithdrawals(): WithdrawalRequest[] {
    return Array.from(this.withdrawals.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public getUserDeposits(userId: string): DepositRequest[] {
    return Array.from(this.deposits.values()).filter((d) => d.userId === userId);
  }

  public getUserWithdrawals(userId: string): WithdrawalRequest[] {
    return Array.from(this.withdrawals.values()).filter((w) => w.userId === userId);
  }

  public getStats() {
    let pendingDepositsAmount = 0;
    let approvedDepositsAmount = 0;
    let pendingWithdrawalsAmount = 0;
    let approvedWithdrawalsAmount = 0;

    for (const d of this.deposits.values()) {
      if (d.status === 'pending') pendingDepositsAmount += d.amount;
      if (d.status === 'approved') approvedDepositsAmount += d.amount;
    }

    for (const w of this.withdrawals.values()) {
      if (w.status === 'pending') pendingWithdrawalsAmount += w.amount;
      if (w.status === 'approved') approvedWithdrawalsAmount += w.amount;
    }

    return {
      totalDepositsCount: this.deposits.size,
      pendingDepositsCount: Array.from(this.deposits.values()).filter((d) => d.status === 'pending').length,
      pendingDepositsAmount,
      approvedDepositsAmount,
      totalWithdrawalsCount: this.withdrawals.size,
      pendingWithdrawalsCount: Array.from(this.withdrawals.values()).filter((w) => w.status === 'pending').length,
      pendingWithdrawalsAmount,
      approvedWithdrawalsAmount,
    };
  }
}

export const paymentRequestService = new PaymentRequestService();
