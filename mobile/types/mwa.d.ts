declare module '@solana-mobile/mobile-wallet-adapter-protocol-web3js' {
  import { Transaction, VersionedTransaction } from '@solana/web3.js';

  export interface AppIdentity {
    name: string;
    uri: string;
    icon: string;
  }

  export interface AuthorizeParams {
    cluster: string;
    identity: AppIdentity;
    auth_token?: string;
  }

  export interface AuthorizeResult {
    accounts: Array<{
      address: string;
      label?: string;
    }>;
    auth_token: string;
  }

  export interface DeauthorizeParams {
    auth_token: string;
  }

  export interface Web3MobileWallet {
    authorize(params: AuthorizeParams): Promise<AuthorizeResult>;
    deauthorize(params: DeauthorizeParams): Promise<void>;
    signTransactions(params: {
      transactions: Array<Transaction | VersionedTransaction>;
    }): Promise<Array<Transaction | VersionedTransaction>>;
    signAndSendTransactions(params: {
      transactions: Array<Transaction | VersionedTransaction>;
    }): Promise<string[]>;
  }

  export function transact<T>(
    callback: (wallet: Web3MobileWallet) => Promise<T>
  ): Promise<T>;
}
