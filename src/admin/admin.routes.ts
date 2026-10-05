import { Router, Request, Response, NextFunction } from 'express';
import { paymentRequestService } from '../wallet/payment-request.service.js';
import { roundService } from '../rounds/round.service.js';
import { binancePriceService } from '../market/binance.service.js';

export const adminRouter = Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || 'super-admin-secret-2026';

function adminAuth(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-admin-key'] || req.query.admin_key;
  if (key !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Admin Secret Key' });
  }
  next();
}

// Public endpoint for Android App update check
adminRouter.get('/app/version', (_req: Request, res: Response) => {
  res.json({
    latestVersionCode: 1,
    latestVersionName: '1.0.0',
    downloadUrl: 'https://download-app.vercel.app/solidgame-v1.0.0.apk',
    releaseNotes: 'Production launch with real-time Binance WebSocket feeds and instant UPI payouts.',
    isMandatory: false,
  });
});

// Protected Admin Routes
adminRouter.use(adminAuth);

adminRouter.get('/stats', (_req: Request, res: Response) => {
  const paymentStats = paymentRequestService.getStats();
  const activeRounds = roundService.getAllActiveRounds().length;
  const prices = binancePriceService.getAllPrices();

  res.json({
    payments: paymentStats,
    activeRounds,
    prices,
    timestamp: Date.now(),
  });
});

adminRouter.get('/deposits', (_req: Request, res: Response) => {
  const deposits = paymentRequestService.getAllDeposits();
  res.json(deposits);
});

adminRouter.post('/deposits/:id/approve', async (req: Request, res: Response) => {
  try {
    const deposit = await paymentRequestService.approveDeposit(req.params.id);
    res.json({ success: true, deposit });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.post('/deposits/:id/reject', (req: Request, res: Response) => {
  try {
    const deposit = paymentRequestService.rejectDeposit(req.params.id);
    res.json({ success: true, deposit });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.get('/withdrawals', (_req: Request, res: Response) => {
  const withdrawals = paymentRequestService.getAllWithdrawals();
  res.json(withdrawals);
});

adminRouter.post('/withdrawals/:id/approve', async (req: Request, res: Response) => {
  try {
    const reqItem = await paymentRequestService.approveWithdrawal(req.params.id);
    res.json({ success: true, withdrawal: reqItem });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.post('/withdrawals/:id/reject', async (req: Request, res: Response) => {
  try {
    const reqItem = await paymentRequestService.rejectWithdrawal(req.params.id);
    res.json({ success: true, withdrawal: reqItem });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.get('/upi-config', (_req: Request, res: Response) => {
  res.json({
    upiId: paymentRequestService.upiId,
    upiName: paymentRequestService.upiName,
  });
});

adminRouter.post('/upi-config', (req: Request, res: Response) => {
  const { upiId, upiName } = req.body;
  if (upiId) paymentRequestService.upiId = upiId;
  if (upiName) paymentRequestService.upiName = upiName;
  res.json({
    success: true,
    upiId: paymentRequestService.upiId,
    upiName: paymentRequestService.upiName,
  });
});
