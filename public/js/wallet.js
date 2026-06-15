// ── Phantom wallet + real $CELESTIA (SPL) transfers ──────────────
import {
  Connection, PublicKey, Transaction,
} from 'https://esm.sh/@solana/web3.js@1.95.4';
import {
  getAssociatedTokenAddress, createTransferInstruction,
  createAssociatedTokenAccountInstruction, getAccount, TOKEN_PROGRAM_ID,
} from 'https://esm.sh/@solana/spl-token@0.4.9';

export const wallet = {
  cfg: null, conn: null, pubkey: null, connected: false,
};

export async function loadConfig() {
  const r = await fetch('/api/config'); wallet.cfg = await r.json();
  // route RPC through our own server (the public RPC blocks browser CORS / 403)
  wallet.conn = new Connection(location.origin + '/api/rpc', { commitment: 'confirmed', disableRetryOnRateLimit: true });
  return wallet.cfg;
}

function provider() {
  const p = window.phantom?.solana || window.solana;
  if (!p || !p.isPhantom) return null;
  return p;
}

export function hasPhantom() { return !!provider(); }

export async function connect() {
  const p = provider();
  if (!p) { window.open('https://phantom.app/', '_blank'); throw new Error('Phantom not found'); }
  const res = await p.connect();
  wallet.pubkey = res.publicKey.toString();
  wallet.connected = true;
  return wallet.pubkey;
}

export async function disconnect() {
  try { await provider()?.disconnect(); } catch {}
  wallet.connected = false; wallet.pubkey = null;
}

// Find the user's actual $CELESTIA token account(s) for the mint (handles
// non-ATA accounts and Token-2022) → returns {pubkey, decimals, programId, raw}.
async function findSkySource() {
  const mint = new PublicKey(wallet.cfg.skyMint);
  const owner = new PublicKey(wallet.pubkey);
  // 1) parsed token accounts owned by the wallet for this mint (handles non-ATA / Token-2022)
  try {
    const resp = await wallet.conn.getParsedTokenAccountsByOwner(owner, { mint });
    if (resp.value.length) {
      let best = resp.value[0];
      for (const v of resp.value) if (BigInt(v.account.data.parsed.info.tokenAmount.amount) > BigInt(best.account.data.parsed.info.tokenAmount.amount)) best = v;
      const info = best.account.data.parsed.info.tokenAmount;
      console.log('[pay] source via owner-accounts:', best.pubkey.toString(), info.uiAmount, '$CELESTIA');
      return { pubkey: best.pubkey, decimals: info.decimals, programId: new PublicKey(best.account.owner), ui: info.uiAmount || 0 };
    }
  } catch (e) { console.warn('[pay] getParsedTokenAccountsByOwner failed:', e.message); }
  // 2) fallback: the classic associated token account
  try {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const acc = await getAccount(wallet.conn, ata);
    console.log('[pay] source via ATA:', ata.toString(), Number(acc.amount) / 10 ** wallet.cfg.skyDecimals, '$CELESTIA');
    return { pubkey: ata, decimals: wallet.cfg.skyDecimals, programId: TOKEN_PROGRAM_ID, ui: Number(acc.amount) / 10 ** wallet.cfg.skyDecimals };
  } catch (e) { console.warn('[pay] ATA fallback failed:', e.message); }
  return null;
}

export async function skyBalance() {
  if (!wallet.connected) return 0;
  try {
    const mint = new PublicKey(wallet.cfg.skyMint);
    const owner = new PublicKey(wallet.pubkey);
    const resp = await wallet.conn.getParsedTokenAccountsByOwner(owner, { mint });
    return resp.value.reduce((t, v) => t + (v.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
  } catch (e) { console.warn('balance error', e); return 0; }
}

// Build, sign (Phantom) and send a $CELESTIA transfer to one or more recipients.
// recipients = [{ owner: base58, amount: wholeTokens }]
export async function payMany(recipients) {
  const p = provider();
  if (!p) throw new Error('Phantom not connected');
  const mint = new PublicKey(wallet.cfg.skyMint);
  const from = new PublicKey(wallet.pubkey);

  const src = await findSkySource();
  if (!src) throw new Error('No $CELESTIA token account found in your wallet.');
  const { pubkey: fromAta, decimals, programId } = src;

  const tx = new Transaction();
  for (const rcpt of recipients) {
    const to = new PublicKey(rcpt.owner);
    const toAta = await getAssociatedTokenAddress(mint, to, false, programId);
    try { await getAccount(wallet.conn, toAta, 'confirmed', programId); }
    catch { tx.add(createAssociatedTokenAccountInstruction(from, toAta, to, mint, programId)); }
    const raw = BigInt(Math.round(rcpt.amount * 10 ** decimals));
    tx.add(createTransferInstruction(fromAta, toAta, from, raw, [], programId));
  }

  const { blockhash } = await wallet.conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash; tx.feePayer = from;
  // Phantom signs + broadcasts. Server polls for the confirmed tx when verifying.
  const { signature } = await p.signAndSendTransaction(tx);
  return signature;
}

export function payTreasury(amount) {
  return payMany([{ owner: wallet.cfg.treasury, amount }]);
}
