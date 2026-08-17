// Account-tier lot sizing. Shared by the browser dashboard and the scheduled
// server-side engine so both size trades identically.

/** Auto-detect the account tier from balance. <500 disables the bot. */
export function detectTier(balance: number): 500 | 1000 | 2000 | null {
  if (balance >= 2000) return 2000;
  if (balance >= 1000) return 1000;
  if (balance >= 500) return 500;
  return null;
}

/** Max simultaneous open lot exposure permitted by tier. */
export function tierLotCap(tier: 500 | 1000 | 2000 | null): number {
  if (tier === 2000) return 1.20;
  if (tier === 1000) return 1.20;
  if (tier === 500) return 0.90;
  return 0;
}

/** Per-trade lot based on live account balance.
 *  ≤$100 → 0.02, ≤$250 → 0.04, ≤$500 → 0.06, ≥$1000 → 0.08. */
export function lotForBalance(balance: number): number {
  if (balance >= 1000) return 0.08;
  if (balance > 250) return 0.06;
  if (balance > 100) return 0.04;
  return 0.02;
}
