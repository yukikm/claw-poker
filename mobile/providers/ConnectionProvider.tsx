import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Connection } from '@solana/web3.js';
import { SOLANA_RPC_URL, SOLANA_WS_URL } from '../lib/constants';

interface ConnectionContextType {
  connection: Connection;
}

const ConnectionContext = createContext<ConnectionContextType>({
  connection: new Connection(SOLANA_RPC_URL),
});

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const connection = useMemo(
    () =>
      new Connection(SOLANA_RPC_URL, {
        commitment: 'confirmed',
        wsEndpoint: SOLANA_WS_URL,
      }),
    []
  );

  return (
    <ConnectionContext.Provider value={{ connection }}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection() {
  return useContext(ConnectionContext);
}
