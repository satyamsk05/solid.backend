import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authService } from '../auth/auth.service.js';
import { authMiddleware, AuthenticatedRequest } from '../auth/auth.middleware.js';
import { walletService } from '../wallet/wallet.service.js';
import { roundService } from '../rounds/round.service.js';
import { betService } from '../bets/bet.service.js';
import { binancePriceService } from '../market/binance.service.js';
import { SUPPORTED_ASSETS, SUPPORTED_TIMEFRAMES } from '../config.js';
import { prisma } from '../database/prisma.js';
import { paymentRequestService } from '../wallet/payment-request.service.js';
import { adminRouter } from '../admin/admin.routes.js';

export const apiRouter = Router();

apiRouter.use('/admin', adminRouter);

// Rate limiter for WhatsApp auth initialization
const logginRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many WhatsApp auth requests. Please wait a minute.' },
});

// ================= AUTH ROUTES =================
// Loggin.dev 1-Tap WhatsApp Auth (Key: CONFIG.logginAppKey)
apiRouter.post('/auth/loggin-init', logginRateLimiter, (_req: Request, res: Response) => {
  try {
    const session = authService.initLoggin();
    return res.json(session);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to initialize WhatsApp auth' });
  }
});

apiRouter.post('/auth/loggin-verify', async (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Loggin token is required' });
  }
  try {
    const result = await authService.verifyLoggin(token);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'WhatsApp verification failed' });
  }
});

apiRouter.get('/auth/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await authService.getUserById(req.userId!);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ================= WALLET ROUTES =================
apiRouter.get('/wallet', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const wallet = await walletService.getWallet(req.userId!);
    return res.json(wallet);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/wallet/transactions', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const transactions = walletService.getTransactions(req.userId!);
    return res.json(transactions);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Disabled direct unverified deposit/withdraw endpoints to prevent unauthorized balance injection
apiRouter.post('/wallet/deposit', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  return res.status(403).json({
    error: 'Direct balance deposits are disabled for security. Please submit a deposit request with UTR via /wallet/deposit-request.',
  });
});

apiRouter.post('/wallet/withdraw', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  return res.status(403).json({
    error: 'Direct unmonitored withdrawals are disabled for security. Please submit a withdrawal request with UPI ID via /wallet/withdraw-request.',
  });
});

apiRouter.get('/wallet/upi-details', (_req: Request, res: Response) => {
  return res.json({
    upiId: paymentRequestService.upiId,
    upiName: paymentRequestService.upiName,
  });
});

apiRouter.post('/wallet/deposit-request', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { amount, utrNumber } = req.body;
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'Valid deposit amount required' });
  }
  if (!utrNumber) {
    return res.status(400).json({ error: '12-digit UTR number is required' });
  }
  try {
    const deposit = paymentRequestService.submitDeposit(req.userId!, req.phone || 'User', numAmount, utrNumber);
    return res.status(201).json({ success: true, deposit });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/wallet/public-deposit-request', async (req: Request, res: Response) => {
  const { phone, amount, utrNumber } = req.body;
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'Valid deposit amount required' });
  }
  if (!phone || typeof phone !== 'string' || phone.trim().length < 10) {
    return res.status(400).json({ error: 'Valid 10-digit registered phone number is required' });
  }
  if (!utrNumber || typeof utrNumber !== 'string' || utrNumber.trim().length < 6) {
    return res.status(400).json({ error: 'Valid 12-digit UTR / Reference number is required' });
  }

  const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-10);
  try {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: cleanPhone },
          { phone: `+91${cleanPhone}` },
        ],
      },
    });

    const userId = user ? user.id : `web-${cleanPhone}`;
    const userDisplayPhone = user ? (user.phone || cleanPhone) : `+91${cleanPhone}`;

    const deposit = paymentRequestService.submitDeposit(userId, userDisplayPhone, numAmount, utrNumber);
    return res.status(201).json({ success: true, deposit });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to submit deposit request' });
  }
});

apiRouter.post('/wallet/withdraw-request', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { amount, upiId } = req.body;
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'Valid withdrawal amount required' });
  }
  if (!upiId) {
    return res.status(400).json({ error: 'Valid UPI ID required' });
  }
  try {
    const withdrawal = await paymentRequestService.submitWithdrawal(req.userId!, req.phone || 'User', numAmount, upiId);
    return res.status(201).json({ success: true, withdrawal });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/wallet/requests', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const deposits = paymentRequestService.getUserDeposits(req.userId!);
  const withdrawals = paymentRequestService.getUserWithdrawals(req.userId!);
  return res.json({ deposits, withdrawals });
});

// ================= ROUND ROUTES =================
apiRouter.get('/rounds/active', (req: Request, res: Response) => {
  const symbol = (req.query.symbol as string) || 'BTCUSDT';
  const timeframe = (req.query.timeframe as string) || '1m';
  const round = roundService.getActiveRound(symbol, timeframe);
  if (!round) {
    return res.status(404).json({ error: 'No active round found for requested asset/timeframe' });
  }
  return res.json(round);
});

apiRouter.get('/rounds/all-active', (_req: Request, res: Response) => {
  const rounds = roundService.getAllActiveRounds();
  return res.json(rounds);
});

apiRouter.get('/rounds/history', (req: Request, res: Response) => {
  const symbol = req.query.symbol as string | undefined;
  const timeframe = req.query.timeframe as string | undefined;
  const history = roundService.getRoundHistory(symbol, timeframe);
  return res.json(history);
});

apiRouter.get('/rounds/:id', (req: Request, res: Response) => {
  const round = roundService.getRoundById(req.params.id);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  return res.json(round);
});

// ================= BETTING ROUTES =================
apiRouter.post('/bets', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { round_id, direction, amount } = req.body;
  const numAmount = parseFloat(amount);

  if (!round_id || !direction || isNaN(numAmount)) {
    return res.status(400).json({ error: 'round_id, direction (up/down), and valid amount are required' });
  }

  if (direction !== 'up' && direction !== 'down') {
    return res.status(400).json({ error: "direction must be 'up' or 'down'" });
  }

  try {
    const bet = await betService.placeBet(req.userId!, round_id, direction, numAmount);
    return res.status(201).json(bet);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to place bet' });
  }
});

apiRouter.get('/bets', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const bets = betService.getBetsByUser(req.userId!);
  return res.json(bets);
});

apiRouter.get('/bets/active', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const activeBets = betService.getActiveBetsByUser(req.userId!);
  return res.json(activeBets);
});

// ================= MARKET ROUTES =================
apiRouter.get('/market/assets', (_req: Request, res: Response) => {
  return res.json({
    assets: SUPPORTED_ASSETS,
    timeframes: SUPPORTED_TIMEFRAMES,
  });
});

apiRouter.get('/market/price/:symbol', (req: Request, res: Response) => {
  const tick = binancePriceService.getPrice(req.params.symbol);
  return res.json(tick);
});

apiRouter.get('/market/prices', (_req: Request, res: Response) => {
  const ticks = binancePriceService.getAllPrices();
  return res.json(ticks);
});
