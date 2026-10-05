import assert from 'assert';
import { walletService, round2 } from '../src/wallet/wallet.service.js';
import { roundService } from '../src/rounds/round.service.js';
import { betService } from '../src/bets/bet.service.js';
import { CONFIG } from '../src/config.js';

async function runTests() {
  console.log('🧪 Starting Solidgame Unit Tests (Pure Real INR Mode)...\n');

  // --- TEST 1: Precision arithmetic & Decimal Rounding ---
  console.log('🔹 Test 1: Precision Arithmetic (Paise-level safety)');
  const floatSum = 0.1 + 0.2;
  assert.notStrictEqual(floatSum, 0.3, 'Native float 0.1 + 0.2 has precision drift');
  const rounded = round2(floatSum);
  assert.strictEqual(rounded, 0.3, 'round2 must round 0.1 + 0.2 cleanly to 0.30');
  console.log('  ✅ round2 handles floating-point rounding correctly');

  // --- TEST 2: Real Wallet Balance & Betting Operations ---
  console.log('🔹 Test 2: Real Wallet Balance & Bet Locking');
  const testUserId = `test-user-${Date.now()}`;
  const initialWallet = await walletService.getWallet(testUserId);

  assert.strictEqual(initialWallet.balance, 1000.0, 'Initial real balance must be ₹1,000.00');
  assert.strictEqual(initialWallet.lockedBalance, 0.0, 'Initial locked balance must be ₹0.00');

  // Lock real funds
  await walletService.lockFundsForBet(testUserId, 200, 'round-real-1');
  const wAfterLock = await walletService.getWallet(testUserId);
  assert.strictEqual(wAfterLock.balance, 800.0, 'Real balance deducted: 1000 - 200 = 800');
  assert.strictEqual(wAfterLock.lockedBalance, 200.0, 'Locked balance set to 200');

  // Settle real win with 1.90x payout
  const payout = round2(200 * CONFIG.payoutMultiplier); // 380.00
  await walletService.settleWonBet(testUserId, 200, payout, 'round-real-1');
  const wAfterWin = await walletService.getWallet(testUserId);
  assert.strictEqual(wAfterWin.balance, 1180.0, 'Real balance credited with win: 800 + 380 = 1180');
  assert.strictEqual(wAfterWin.lockedBalance, 0.0, 'Locked cleared to 0');
  console.log('  ✅ Real wallet correctly handles fund locking and 1.90x payout');

  // --- TEST 3: Draw Settlement Returns Full Capital ---
  console.log('🔹 Test 3: Draw Settlement Returns 100% Capital');
  await walletService.lockFundsForBet(testUserId, 180, 'round-real-2');
  const wLock2 = await walletService.getWallet(testUserId);
  assert.strictEqual(wLock2.balance, 1000.0, 'Balance: 1180 - 180 = 1000');
  assert.strictEqual(wLock2.lockedBalance, 180.0, 'Locked: 180');

  await walletService.settleDrawBet(testUserId, 180, 'round-real-2');
  const wRefund = await walletService.getWallet(testUserId);
  assert.strictEqual(wRefund.balance, 1180.0, 'Draw refunds 100% capital: 1000 + 180 = 1180');
  assert.strictEqual(wRefund.lockedBalance, 0.0, 'Locked cleared');
  console.log('  ✅ Draw correctly refunds 100% of user capital');

  // --- TEST 4: Lost Bet Deducts Locked Funds Cleanly ---
  console.log('🔹 Test 4: Lost Bet Deducts Locked Balance');
  await walletService.lockFundsForBet(testUserId, 180, 'round-real-3');
  await walletService.settleLostBet(testUserId, 180, 'round-real-3');
  const wLost = await walletService.getWallet(testUserId);
  assert.strictEqual(wLost.balance, 1000.0, 'Available balance remains 1000');
  assert.strictEqual(wLost.lockedBalance, 0.0, 'Locked balance cleared');
  console.log('  ✅ Lost bet settles cleanly');

  // --- TEST 5: Betting Window Anti-Cheat Rule ---
  console.log('🔹 Test 5: Betting Window Anti-Cheat Rule');
  await roundService.start();
  const activeRound = roundService.getActiveRound('BTCUSDT', '1m');
  assert.ok(activeRound, 'Active BTCUSDT 1m round must exist');
  assert.strictEqual(activeRound.status, 'betting', 'Round begins in betting state');

  // Valid bet during window
  const validBet = await betService.placeBet(testUserId, activeRound.id, 'up', 100);
  assert.strictEqual(validBet.direction, 'up');
  assert.strictEqual(validBet.potentialPayout, 190.0, '100 * 1.90 = 190.00');

  // Simulate window closed
  activeRound.status = 'locked';
  try {
    await betService.placeBet(testUserId, activeRound.id, 'up', 100);
    assert.fail('Betting should have thrown error when round is locked');
  } catch (err: any) {
    assert.strictEqual(err.message, 'Betting window for this round is closed');
  }
  console.log('  ✅ Server strictly blocks bets after betting window closes');

  console.log('\n🎉 ALL UNIT TEST SUITES PASSED PERFECTLY (100% REAL MONEY ENGINE)!\n');
  process.exit(0);
}

runTests().catch((e) => {
  console.error('❌ Test failed with error:', e);
  process.exit(1);
});
