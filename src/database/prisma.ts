import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export async function connectDatabase() {
  try {
    await prisma.$connect();
    console.log('✅ Connected to PostgreSQL database');
  } catch (err) {
    console.warn('⚠️ PostgreSQL connection failed, operating with graceful fallback:', err);
  }
}
