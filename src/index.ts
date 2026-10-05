import express from 'express';
import http from 'http';
import cors from 'cors';
import { CONFIG } from './config.js';
import { connectDatabase } from './database/prisma.js';
import { binancePriceService } from './market/binance.service.js';
import { roundService } from './rounds/round.service.js';
import { SocketGateway } from './websocket/socket.gateway.js';
import { apiRouter } from './api/routes.js';

const app = express();
const server = http.createServer(app);

// Middlewares
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', apiRouter);

// Root health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
    activeRounds: roundService.getAllActiveRounds().length,
  });
});

// Initialize real-time Socket Gateway
new SocketGateway(server);

async function bootstrap() {
  console.log('🚀 Starting Solidgame Backend...');

  // 1. Connect to Database (with graceful fallback)
  await connectDatabase();

  // 2. Start Binance WebSocket Price Ingestion
  binancePriceService.start();

  // 3. Start Automated Round Engine
  await roundService.start();

  // 4. Start HTTP & WebSocket Server
  server.listen(CONFIG.port, () => {
    console.log(`
===========================================================
🔥 Solidgame Engine is LIVE!
🌐 HTTP API Server:    http://localhost:${CONFIG.port}/api
📡 WebSocket Gateway:  ws://localhost:${CONFIG.port}
🩺 Health Check:       http://localhost:${CONFIG.port}/health
===========================================================
    `);
  });
}

bootstrap().catch((err) => {
  console.error('❌ Fatal error during bootstrap:', err);
  process.exit(1);
});
