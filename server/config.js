import dotenv from 'dotenv';
dotenv.config();

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  PORT: num(process.env.PORT, 3000),
  PUBLIC_WS_URL: process.env.PUBLIC_WS_URL || '',

  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  SOLANA_CLUSTER: process.env.SOLANA_CLUSTER || 'mainnet-beta',

  SKY_TOKEN_MINT: process.env.SKY_TOKEN_MINT || '8fa3FLWEk4Y7XLAGsQT8tpA8EcfsfQ9ZgEQVYcAvpump',
  SKY_TOKEN_DECIMALS: num(process.env.SKY_TOKEN_DECIMALS, 6),

  TREASURY_WALLET: process.env.TREASURY_WALLET || 'DwDoTqae91mTDMskLJgvjwiXz8rsTADdTAxH9YeA4Niq',

  TERRITORY_PRICE_SKY: num(process.env.TERRITORY_PRICE_SKY, 10000),
  MARKETPLACE_FEE: num(process.env.MARKETPLACE_FEE, 0.02),
};

// Values that are safe to expose to the browser client.
export function publicConfig() {
  return {
    rpcUrl: config.SOLANA_RPC_URL,
    cluster: config.SOLANA_CLUSTER,
    skyMint: config.SKY_TOKEN_MINT,
    skyDecimals: config.SKY_TOKEN_DECIMALS,
    treasury: config.TREASURY_WALLET,
    territoryPrice: config.TERRITORY_PRICE_SKY,
    marketplaceFee: config.MARKETPLACE_FEE,
    wsUrl: config.PUBLIC_WS_URL,
  };
}
