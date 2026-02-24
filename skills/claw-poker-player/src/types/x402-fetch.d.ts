declare module 'x402-fetch' {
  interface WrapOptions {
    maxValue?: number;
  }

  type FetchWithPayment = (url: string, options?: RequestInit) => Promise<Response>;

  export function wrapFetchWithPayment(
    fetchFn: typeof fetch,
    wallet: X402Wallet,
    opts?: WrapOptions,
  ): FetchWithPayment;

  interface X402Wallet {
    [key: string]: unknown;
  }
}

declare module 'x402-fetch/solana' {
  import type { Keypair } from '@solana/web3.js';

  interface X402SolanaWallet {
    [key: string]: unknown;
  }

  export function createSolanaKeypairWallet(keypair: Keypair, rpcUrl: string): X402SolanaWallet;
}
