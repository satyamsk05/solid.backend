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
  private users: Map<string, UserProfile> = new Map();

  constructor() {}

  /**
   * Initializes a WhatsApp loggin session using key from CONFIG
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

  public async createSessionForPhone(phone: string): Promise<{ token: string; user: UserProfile }> {
    // 1. Check in-memory cache
    let user: UserProfile | undefined;
    for (const u of this.users.values()) {
      if (u.phone === phone) {
        user = u;
        break;
      }
    }

    // 2. If not in memory, check Database
    if (!user) {
      try {
        const dbUser = await prisma.user.findUnique({ where: { phone } });
        if (dbUser) {
          user = {
            id: dbUser.id,
            phone: dbUser.phone || phone,
            name: dbUser.name || `Trader_${phone.slice(-4)}`,
            balance: Number(dbUser.balance),
            lockedBalance: Number(dbUser.lockedBalance),
          };
          this.users.set(user.id, user);
        }
      } catch (e) {
        // Fallback if DB is offline
      }
    }

    // 3. If still not found, create new user
    if (!user) {
      const id = uuidv4();
      user = {
        id,
        phone,
        name: `Trader_${phone.slice(-4)}`,
        balance: 0.0,
        lockedBalance: 0.0,
      };
      this.users.set(id, user);

      // Persist in DB
      try {
        await prisma.user.create({
          data: {
            id: user.id,
            phone: user.phone,
            name: user.name,
            balance: user.balance,
            lockedBalance: user.lockedBalance,
          },
        });
      } catch (err) {
        console.warn('⚠️ Could not persist new user to DB:', err);
      }
    }

    // Refresh wallet balances
    const wallet = await walletService.getWallet(user.id);
    user.balance = wallet.balance;
    user.lockedBalance = wallet.lockedBalance;

    const token = jwt.sign({ userId: user.id, phone: user.phone }, CONFIG.jwtSecret, {
      expiresIn: (CONFIG.jwtExpiresIn || '7d') as any,
    });

    return { token, user };
  }

  public async getUserById(userId: string): Promise<UserProfile | null> {
    let user = this.users.get(userId);

    // If not in cache, fetch from database
    if (!user) {
      try {
        const dbUser = await prisma.user.findUnique({ where: { id: userId } });
        if (dbUser) {
          user = {
            id: dbUser.id,
            phone: dbUser.phone || '',
            name: dbUser.name || `Trader_${dbUser.id.slice(-4)}`,
            balance: Number(dbUser.balance),
            lockedBalance: Number(dbUser.lockedBalance),
          };
          this.users.set(userId, user);
        }
      } catch (e) {
        // Fallback
      }
    }

    if (!user) return null;

    const wallet = await walletService.getWallet(userId);
    user.balance = wallet.balance;
    user.lockedBalance = wallet.lockedBalance;
    return user;
  }
}

export const authService = new AuthService();
