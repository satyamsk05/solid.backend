import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { binancePriceService, PriceTick } from '../market/binance.service.js';
import { roundService, ActiveRound } from '../rounds/round.service.js';
import { betService } from '../bets/bet.service.js';

export class SocketGateway {
  private io: SocketIOServer;

  constructor(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    this.setupListeners();
  }

  private setupListeners() {
    this.io.on('connection', (socket: Socket) => {
      console.log(`🔌 Client connected to WebSocket: ${socket.id}`);

      // Handle user registration for personal notifications
      socket.on('authenticate', (data: { userId: string }) => {
        if (data && data.userId) {
          socket.join(`user:${data.userId}`);
          console.log(`👤 Socket ${socket.id} joined user channel: user:${data.userId}`);
        }
      });

      // Handle round subscription
      socket.on('subscribe_round', (data: { symbol: string; timeframe: string }) => {
        if (data && data.symbol && data.timeframe) {
          const room = `round:${data.symbol.toUpperCase()}:${data.timeframe}`;
          socket.join(room);
          console.log(`📡 Socket ${socket.id} subscribed to room: ${room}`);

          // Send current round state immediately
          const activeRound = roundService.getActiveRound(data.symbol, data.timeframe);
          if (activeRound) {
            socket.emit('round_update', activeRound);
          }

          // Send current price tick immediately
          const tick = binancePriceService.getPrice(data.symbol);
          socket.emit('price_update', tick);
        }
      });

      socket.on('unsubscribe_round', (data: { symbol: string; timeframe: string }) => {
        if (data && data.symbol && data.timeframe) {
          const room = `round:${data.symbol.toUpperCase()}:${data.timeframe}`;
          socket.leave(room);
        }
      });

      socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected from WebSocket: ${socket.id}`);
      });
    });

    // 1. Broadcast price updates
    binancePriceService.on('price', (tick: PriceTick) => {
      this.io.emit('price_update', tick);
    });

    // 2. Broadcast round updates to specific rooms and general broadcast
    roundService.on('round_update', (round: ActiveRound) => {
      const room = `round:${round.symbol.toUpperCase()}:${round.timeframe}`;
      this.io.to(room).emit('round_update', round);
      this.io.emit('round_update', round);
    });

    // 3. User-specific bet results
    betService.on('bet_result', (payload: { betId: string; userId: string; result: string; payoutAmount: number }) => {
      this.io.to(`user:${payload.userId}`).emit('bet_result', payload);
    });

    // 4. User-specific wallet updates
    betService.on('wallet_update', (payload: { userId: string; wallet: any }) => {
      this.io.to(`user:${payload.userId}`).emit('wallet_update', payload.wallet);
    });
  }
}
