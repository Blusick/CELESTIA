// ─────────────────────────────────────────────────────────────
//  On-chain verification of $Lunaris (SPL) payments to the treasury.
//  The client builds + signs + sends a transfer via Phantom, then
//  hands us the signature. We confirm it on-chain and check that
//  the treasury's $Lunaris balance rose by at least the expected amount.
// ─────────────────────────────────────────────────────────────
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { config } from './config.js';

const connection = new Connection(config.SOLANA_RPC_URL, 'confirmed');
const MINT = new PublicKey(config.SKY_TOKEN_MINT);
const TREASURY = new PublicKey(config.TREASURY_WALLET);

// Treasury's associated token accounts (classic Token + Token-2022) for $Lunaris.
let treasuryAtas = null;
async function getTreasuryAtas() {
  if (!treasuryAtas) {
    const a = (await getAssociatedTokenAddress(MINT, TREASURY, true, TOKEN_PROGRAM_ID)).toBase58();
    const b = (await getAssociatedTokenAddress(MINT, TREASURY, true, TOKEN_2022_PROGRAM_ID)).toBase58();
    treasuryAtas = new Set([a, b]);
  }
  return treasuryAtas;
}

const seenSignatures = new Set(); // prevent replay of one tx for two purchases

/**
 * Verify a Phantom-sent SPL transfer.
 * @param {string} signature  base58 tx signature
 * @param {number} minAmount  minimum whole-token amount that must reach the treasury
 * @param {string} [expectedFrom] optional payer wallet (base58)
 * @returns {{ok:boolean, amount?:number, error?:string}}
 */
export async function verifyPayment(signature, minAmount, expectedFrom) {
  if (!signature || typeof signature !== 'string')
    return { ok: false, error: 'missing signature' };
  if (seenSignatures.has(signature))
    return { ok: false, error: 'signature already used' };

  // poll for the confirmed transaction (the client no longer waits)
  let tx = null, lastErr = '';
  for (let i = 0; i < 12 && !tx; i++) {
    try {
      tx = await connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    } catch (e) { lastErr = e.message; }
    if (!tx) await new Promise(r => setTimeout(r, 1500));
  }
  if (!tx) return { ok: false, error: 'transaction not confirmed yet' + (lastErr ? ' (' + lastErr + ')' : '') };
  if (tx.meta?.err) return { ok: false, error: 'transaction failed on-chain' };

  const mint = MINT.toBase58();
  const treasury = TREASURY.toBase58();
  const atas = await getTreasuryAtas();
  // map accountIndex → account pubkey so we can match by the treasury's token account, not only the `owner` field
  const keys = (tx.transaction.message.accountKeys || []).map(k => (k.pubkey ? k.pubkey.toString() : k.toString()));
  const sumTreasury = (list) => {
    let s = 0;
    for (const b of (list || [])) {
      if (b.mint !== mint) continue;
      const acct = keys[b.accountIndex];
      if (b.owner === treasury || atas.has(acct)) s += Number(b.uiTokenAmount?.uiAmount || 0);
    }
    return s;
  };
  const received = sumTreasury(tx.meta?.postTokenBalances) - sumTreasury(tx.meta?.preTokenBalances);

  if (received + 1e-9 < minAmount) {
    const hadBalances = (tx.meta?.postTokenBalances || []).length > 0;
    console.warn(`[pay] verify failed: received ${received}, expected >= ${minAmount}; tokenBalancesInTx=${hadBalances ? 'yes' : 'NO (RPC returned no token meta — set a dedicated SOLANA_RPC_URL)'}`);
    return { ok: false, error: `treasury received ${received} $Lunaris, expected >= ${minAmount}` };
  }

  if (expectedFrom) {
    const signers = (tx.transaction.message.accountKeys || [])
      .filter(k => k.signer).map(k => k.pubkey.toString());
    if (!signers.includes(expectedFrom))
      return { ok: false, error: 'payer is not a signer of this transaction' };
  }

  seenSignatures.add(signature);
  return { ok: true, amount: received, mint };
}

export { connection, MINT, TREASURY };
