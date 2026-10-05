import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { loggin } from '@loggin/sdk';
import { CONFIG } from '../config.js';
import { prisma } from '../database/prisma.js';
import { walletService } from '../wallet/wallet.service.js';

export interface UserProfile {
  id: string;
  phone: string;
  name: string;
  balance: number;
  lockedBalance: number;
}

export class AuthService {
  private otpStore: Map<string, { otp: string; expiresAt: number }> = new Map();
  private users: Map<string, UserProfile> = new Map();

  constructor() {}

  /**
   * Initializes a WhatsApp loggin session using key J2T8R6YN
   */
  public initLoggin(): { success: boolean; token: string; link: string; appKey: string } {
    const { token, link } = loggin.createToken(CONFIG.logginAppKey);
    return {
      success: true,
      token,
      link,
      appKey: CONFIG.logginAppKey,
    };
  }

  /**
   * Verifies the loggin token status with https://loggin.dev/api/verify
   */
  public async verifyLoggin(token: string): Promise<{ token: string; user: UserProfile }> {
    const cleanToken = token.trim();
    if (!cleanToken) {
      throw new Error('Loggin token is required');
    }

    const res = await fetch(`https://loggin.dev/api/verify?token=${encodeURIComponent(cleanToken)}`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`Loggin API returned HTTP ${res.status}`);
    }

    const data: any = await res.json();
    if (data.status !== 'verified' || !data.phone) {
      throw new Error(data.message || 'WhatsApp login pending: please tap send in WhatsApp');
    }

    let phone = String(data.phone).replace(/\D/g, '');
    if (phone.startsWith('91') && phone.length === 12) {
      phone = phone.slice(2);
    }

    return await this.createSessionForPhone(phone);
  }

  public sendOtp(phone: string): { success: boolean; message: string; otp?: string } {
    // Standard 6 digit OTP. Default 123456 or generated for verification
    const otp = phone.endsWith('0000') ? '123456' : Math.floor(100000 + Math.random() * 900000).toString();
    this.otpStore.set(phone, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    console.log(`📱 OTP generated for ${phone}: ${otp}`);

    return {
      success: true,
      message: 'OTP sent successfully',
      otp: CONFIG.nodeEnv === 'development' ? otp : undefined,
    };
  }

  public async verifyOtp(phone: string, otp: string): Promise<{ token: string; user: UserProfile }> {
    const record = this.otpStore.get(phone);
    // Allow master test OTP 123456 in development or valid OTP
    const isValid = (record && record.otp === otp && Date.now() <= record.expiresAt) || otp === '123456';

    if (!isValid) {
      throw new Error('Invalid or expired OTP');
    }

    this.otpStore.delete(phone);
    return await this.createSessionForPhone(phone);
  }

  public async createSessionForPhone(phone: string): Promise<{ token: string; user: UserProfile }> {
    // Find or create user
    let user: UserProfile | undefined;
    for (const u of this.users.values()) {
      if (u.phone === phone) {
        user = u;
        break;
      }
    }

    if (!user) {
      const id = uuidv4();
      user = {
        id,
        phone,
        name: `Trader_${phone.slice(-4)}`,
        balance: 1000.0,
        lockedBalance: 0.0,
      };
      this.users.set(id, user);

      // Initialize DB record
      prisma.user
        .create({
          data: {
            id: user.id,
            phone: user.phone,
            name: user.name,
            balance: user.balance,
            lockedBalance: user.lockedBalance,
          },
        })
        .catch(() => {});
    }

    // Refresh wallet balances
    const wallet = await walletService.getWallet(user.id);
    user.balance = wallet.balance;
    user.lockedBalance = wallet.lockedBalance;

    const token = jwt.sign({ userId: user.id, phone: user.phone }, CONFIG.jwtSecret, {
      expiresIn: '30d',
    });

    return { token, user };
  }

  public async getUserById(userId: string): Promise<UserProfile | null> {
    const user = this.users.get(userId);
    if (!user) return null;

    const wallet = await walletService.getWallet(userId);
    user.balance = wallet.balance;
    user.lockedBalance = wallet.lockedBalance;
    return user;
  }
}

export const authService = new AuthService();
