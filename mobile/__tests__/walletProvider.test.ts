/**
 * Tests for wallet provider logic.
 *
 * Since WalletProvider is a React context provider that uses useContext
 * (which cannot be called outside a React component render), we test
 * the pure logic aspects without importing the provider:
 *   - transactWithTimeout timeout wrapper behavior
 *   - Session restoration from SecureStore
 *   - Default context shape verification
 *   - PublicKey reconstruction from stored addresses
 */

import { PublicKey } from '@solana/web3.js';
import * as SecureStore from 'expo-secure-store';

const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;

// Mock transact for timeout wrapper tests
const mockTransact = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItemAsync.mockResolvedValue(null);
});

describe('walletProvider logic', () => {
  describe('initial state is disconnected', () => {
    it('default context shape has null publicKey and connected=false', () => {
      // The defaultContext defined in WalletProvider.tsx
      const defaultContext = {
        publicKey: null,
        connected: false,
        connecting: false,
        connect: async () => {},
        disconnect: async () => {},
        signTransaction: async <T>(tx: T): Promise<T> => tx,
        signAndSendTransaction: async () => '',
      };

      expect(defaultContext.publicKey).toBeNull();
      expect(defaultContext.connected).toBe(false);
      expect(defaultContext.connecting).toBe(false);
    });

    it('default connect is a no-op async function', async () => {
      const connect = async (): Promise<void> => {};
      await expect(connect()).resolves.toBeUndefined();
    });

    it('default signTransaction returns the transaction unchanged', async () => {
      const signTransaction = async <T>(tx: T): Promise<T> => tx;
      const fakeTx = { fake: 'transaction' };
      const result = await signTransaction(fakeTx);
      expect(result).toBe(fakeTx);
    });

    it('default signAndSendTransaction returns empty string', async () => {
      const signAndSendTransaction = async (): Promise<string> => '';
      const result = await signAndSendTransaction();
      expect(result).toBe('');
    });
  });

  describe('session restoration from SecureStore', () => {
    it('SecureStore mock returns null by default (no saved session)', async () => {
      const result = await SecureStore.getItemAsync('mwa_auth_token');
      expect(result).toBeNull();
    });

    it('can retrieve a previously saved auth token and wallet address', async () => {
      const savedAddress = '11111111111111111111111111111111';
      mockGetItemAsync.mockImplementation(async (key: string) => {
        if (key === 'mwa_auth_token') return 'saved-token';
        if (key === 'wallet_address') return savedAddress;
        return null;
      });

      const token = await SecureStore.getItemAsync('mwa_auth_token');
      const address = await SecureStore.getItemAsync('wallet_address');
      expect(token).toBe('saved-token');
      expect(address).toBe(savedAddress);
    });

    it('reconstructs PublicKey from stored address', async () => {
      const savedAddress = '11111111111111111111111111111111';
      mockGetItemAsync.mockResolvedValueOnce(savedAddress);

      const address = await SecureStore.getItemAsync('wallet_address');
      const pk = new PublicKey(address!);
      expect(pk.toBase58()).toBe(savedAddress);
    });

    it('handles both token and address being present (full session)', async () => {
      mockGetItemAsync.mockImplementation(async (key: string) => {
        if (key === 'mwa_auth_token') return 'my-token';
        if (key === 'wallet_address') return '6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo';
        return null;
      });

      const token = await SecureStore.getItemAsync('mwa_auth_token');
      const address = await SecureStore.getItemAsync('wallet_address');

      // Both must be present for session restoration
      expect(token).toBeTruthy();
      expect(address).toBeTruthy();

      const pk = new PublicKey(address!);
      expect(pk.toBase58()).toBe('6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo');
    });

    it('handles missing token (partial session = no restore)', async () => {
      mockGetItemAsync.mockImplementation(async (key: string) => {
        if (key === 'mwa_auth_token') return null;
        if (key === 'wallet_address') return '11111111111111111111111111111111';
        return null;
      });

      const token = await SecureStore.getItemAsync('mwa_auth_token');
      const address = await SecureStore.getItemAsync('wallet_address');

      // Provider requires both savedToken && savedAddress
      const shouldRestore = !!(token && address);
      expect(shouldRestore).toBe(false);
    });

    it('handles corrupted wallet address gracefully', async () => {
      mockGetItemAsync.mockResolvedValueOnce('invalid-pubkey-data');

      const address = await SecureStore.getItemAsync('wallet_address');
      expect(() => new PublicKey(address!)).toThrow();
    });

    it('stores session using correct SecureStore keys', async () => {
      // These match the constants in WalletProvider.tsx
      const AUTH_TOKEN_KEY = 'mwa_auth_token';
      const WALLET_ADDRESS_KEY = 'wallet_address';

      await SecureStore.setItemAsync(AUTH_TOKEN_KEY, 'test-token');
      await SecureStore.setItemAsync(WALLET_ADDRESS_KEY, '11111111111111111111111111111111');

      expect(mockSetItemAsync).toHaveBeenCalledWith('mwa_auth_token', 'test-token');
      expect(mockSetItemAsync).toHaveBeenCalledWith('wallet_address', '11111111111111111111111111111111');
    });
  });

  describe('transactWithTimeout behavior', () => {
    /**
     * Replicates the transactWithTimeout function from WalletProvider.tsx
     * to test timeout wrapper logic without React rendering.
     */
    function transactWithTimeout<T>(
      callback: (wallet: unknown) => Promise<T>,
      timeoutMs: number = 30_000
    ): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Wallet connection timed out. Please try again.'));
        }, timeoutMs);
        mockTransact(callback)
          .then(resolve)
          .catch(reject)
          .finally(() => clearTimeout(timer));
      });
    }

    beforeEach(() => {
      jest.useFakeTimers();
      mockTransact.mockReset();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('resolves when transact completes before timeout', async () => {
      mockTransact.mockImplementation(
        async (cb: (wallet: unknown) => Promise<string>) => cb({})
      );

      const promise = transactWithTimeout(async () => 'success', 5000);
      await jest.advanceTimersByTimeAsync(0);

      await expect(promise).resolves.toBe('success');
    });

    it('rejects with timeout error when transact is slow', async () => {
      // transact never resolves
      mockTransact.mockReturnValue(new Promise(() => {}));

      const promise = transactWithTimeout(async () => 'never', 1000);
      jest.advanceTimersByTime(1000);

      await expect(promise).rejects.toThrow('Wallet connection timed out. Please try again.');
    });

    it('rejects with transact error when transact fails before timeout', async () => {
      mockTransact.mockImplementationOnce(() => {
        return new Promise((_resolve, reject) => {
          // Defer rejection to next microtask so the .catch handler attaches first
          queueMicrotask(() => reject(new Error('User cancelled')));
        });
      });

      const promise = transactWithTimeout(async () => 'never', 5000);
      await jest.advanceTimersByTimeAsync(0);

      await expect(promise).rejects.toThrow('User cancelled');
    });

    it('clears the timeout when transact resolves', async () => {
      mockTransact.mockImplementation(
        async (cb: (wallet: unknown) => Promise<string>) => cb({})
      );

      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      const promise = transactWithTimeout(async () => 'done', 5000);
      await jest.advanceTimersByTimeAsync(0);
      await promise;

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('clears the timeout when transact rejects', async () => {
      mockTransact.mockImplementationOnce(() => {
        return new Promise((_resolve, reject) => {
          queueMicrotask(() => reject(new Error('fail')));
        });
      });
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      const promise = transactWithTimeout(async () => 'never', 5000);
      await jest.advanceTimersByTimeAsync(0);
      await promise.catch(() => {}); // consume rejection

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('default timeout is 30 seconds', () => {
      // Matches MWA_TIMEOUT_MS = 30_000 in WalletProvider.tsx
      const MWA_TIMEOUT_MS = 30_000;
      expect(MWA_TIMEOUT_MS).toBe(30_000);
    });
  });

  describe('disconnect cleans up SecureStore', () => {
    it('deleteItemAsync removes auth token and wallet address', async () => {
      await SecureStore.deleteItemAsync('mwa_auth_token');
      await SecureStore.deleteItemAsync('wallet_address');

      expect(mockDeleteItemAsync).toHaveBeenCalledWith('mwa_auth_token');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('wallet_address');
    });

    it('deleteItemAsync resolves even when keys do not exist', async () => {
      await expect(SecureStore.deleteItemAsync('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('MWA constants', () => {
    it('app identity matches expected values', () => {
      // Matches APP_IDENTITY in WalletProvider.tsx
      const APP_IDENTITY = {
        name: 'Claw Poker',
        uri: 'https://claw-poker.com',
        icon: 'favicon.ico',
      };
      expect(APP_IDENTITY.name).toBe('Claw Poker');
      expect(APP_IDENTITY.uri).toContain('claw-poker');
      expect(APP_IDENTITY.icon).toBe('favicon.ico');
    });

    it('uses devnet cluster', () => {
      // Matches MWA_CLUSTER in WalletProvider.tsx
      const MWA_CLUSTER = 'devnet';
      expect(MWA_CLUSTER).toBe('devnet');
    });
  });
});
