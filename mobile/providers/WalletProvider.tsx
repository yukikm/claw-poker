import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { transact, type Web3MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { PublicKey, type Transaction, type VersionedTransaction } from '@solana/web3.js';
import * as SecureStore from 'expo-secure-store';

interface WalletContextType {
  publicKey: PublicKey | null;
  connected: boolean;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
  signAndSendTransaction: (tx: Transaction | VersionedTransaction) => Promise<string>;
}

const defaultContext: WalletContextType = {
  publicKey: null,
  connected: false,
  connecting: false,
  connect: async () => {},
  disconnect: async () => {},
  signTransaction: async (tx) => tx,
  signAndSendTransaction: async () => '',
};

const WalletContext = createContext<WalletContextType>(defaultContext);

const APP_IDENTITY = {
  name: 'Claw Poker',
  uri: 'https://claw-poker.com',
  icon: 'favicon.ico',
};

const AUTH_TOKEN_KEY = 'mwa_auth_token';
const WALLET_ADDRESS_KEY = 'wallet_address';
const MWA_CLUSTER = 'devnet';
const MWA_TIMEOUT_MS = 30_000;

/** transact() にタイムアウトを付与するラッパー */
function transactWithTimeout<T>(
  callback: (wallet: Web3MobileWallet) => Promise<T>,
  timeoutMs: number = MWA_TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Wallet connection timed out. Please try again.'));
    }, timeoutMs);
    transact(callback)
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

export function MobileWalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // Ref to avoid stale closure on authToken
  const authTokenRef = useRef<string | null>(null);
  useEffect(() => { authTokenRef.current = authToken; }, [authToken]);

  // Restore session on mount
  useEffect(() => {
    const restore = async () => {
      const savedToken = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
      const savedAddress = await SecureStore.getItemAsync(WALLET_ADDRESS_KEY);
      if (savedToken && savedAddress) {
        setAuthToken(savedToken);
        setPublicKey(new PublicKey(savedAddress));
      }
    };
    restore().catch(console.error);
  }, []);

  /** MWA transact内で再認証し、トークンを更新する共通ヘルパー（ロック付き） */
  const reauthorizePromiseRef = useRef<Promise<void> | null>(null);
  const reauthorize = useCallback(async (wallet: Web3MobileWallet): Promise<void> => {
    // Prevent concurrent reauthorizations racing each other
    if (reauthorizePromiseRef.current) {
      await reauthorizePromiseRef.current;
      return;
    }
    const doReauth = async () => {
      const currentToken = authTokenRef.current;
      const result = await wallet.authorize({
        cluster: MWA_CLUSTER,
        identity: APP_IDENTITY,
        auth_token: currentToken ?? undefined,
      });
      if (result.auth_token !== currentToken) {
        setAuthToken(result.auth_token);
        authTokenRef.current = result.auth_token;
        await SecureStore.setItemAsync(AUTH_TOKEN_KEY, result.auth_token);
      }
    };
    reauthorizePromiseRef.current = doReauth();
    try {
      await reauthorizePromiseRef.current;
    } finally {
      reauthorizePromiseRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const result = await transactWithTimeout(async (wallet: Web3MobileWallet) => {
        const auth = await wallet.authorize({
          cluster: MWA_CLUSTER,
          identity: APP_IDENTITY,
        });
        return auth;
      });
      const address = new PublicKey(result.accounts[0].address);
      setPublicKey(address);
      setAuthToken(result.auth_token);
      authTokenRef.current = result.auth_token;
      await SecureStore.setItemAsync(AUTH_TOKEN_KEY, result.auth_token);
      await SecureStore.setItemAsync(WALLET_ADDRESS_KEY, address.toBase58());
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const currentToken = authTokenRef.current;
    if (currentToken) {
      try {
        await transactWithTimeout(async (wallet: Web3MobileWallet) => {
          await wallet.deauthorize({ auth_token: currentToken });
        });
      } catch {
        // Deauthorization failure is non-critical
      }
    }
    setPublicKey(null);
    setAuthToken(null);
    authTokenRef.current = null;
    await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
    await SecureStore.deleteItemAsync(WALLET_ADDRESS_KEY);
  }, []);

  const signTransaction = useCallback(
    async (tx: Transaction | VersionedTransaction) => {
      return await transactWithTimeout(async (wallet: Web3MobileWallet) => {
        await reauthorize(wallet);
        const signed = await wallet.signTransactions({ transactions: [tx] });
        return signed[0];
      });
    },
    [reauthorize]
  );

  const signAndSendTransaction = useCallback(
    async (tx: Transaction | VersionedTransaction) => {
      return await transactWithTimeout(async (wallet: Web3MobileWallet) => {
        await reauthorize(wallet);
        const signatures = await wallet.signAndSendTransactions({
          transactions: [tx],
        });
        return signatures[0];
      });
    },
    [reauthorize]
  );

  return (
    <WalletContext.Provider
      value={{
        publicKey,
        connected: !!publicKey,
        connecting,
        connect,
        disconnect,
        signTransaction,
        signAndSendTransaction,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
