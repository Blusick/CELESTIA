// ─────────────────────────────────────────────────────────────
//  On-chain verification of $CELESTIA (SPL) payments to the treasury.
//  The client builds + signs + sends a transfer via Phantom, then
//  hands us the signature. We confirm it on-chain and check that
//  the treasury's $CELESTIA balance rose by at least the expected amount.
// ─────────────────────────────────────────────────────────────
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { config } from './config.js';

const connection = new Connection(config.SOLANA_RPC_URL, 'confirmed');
const MINT = new PublicKey(config.SKY_TOKEN_MINT);
const TREASURY = new PublicKey(config.TREASURY_WALLET);

// Treasury's associated token account for $CELESTIA.
let treasuryAta = null;
async function getTreasuryAta() {
  if (!treasuryAta) treasuryAta = await getAssociatedTokenAddress(MINT, TREASURY, true);
  return treasuryAta;
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

  const ata = (await getTreasuryAta()).toBase58();
  const mint = MINT.toBase58();

  // Compare treasury token balance before vs after.
  const pre = (tx.meta.preTokenBalances || []).find(
    b => b.mint === mint && b.owner === TREASURY.toBase58());
  const post = (tx.meta.postTokenBalances || []).find(
    b => b.mint === mint && b.owner === TREASURY.toBase58());

  const preAmt = pre ? Number(pre.uiTokenAmount.uiAmount || 0) : 0;
  const postAmt = post ? Number(post.uiTokenAmount.uiAmount || 0) : 0;
  const received = postAmt - preAmt;

  if (received + 1e-9 < minAmount)
    return { ok: false, error: `treasury received ${received} $CELESTIA, expected >= ${minAmount}` };

  if (expectedFrom) {
    const signers = (tx.transaction.message.accountKeys || [])
      .filter(k => k.signer).map(k => k.pubkey.toString());
    if (!signers.includes(expectedFrom))
      return { ok: false, error: 'payer is not a signer of this transaction' };
  }

  seenSignatures.add(signature);
  return { ok: true, amount: received, ata, mint };
}

export { connection, MINT, TREASURY };
