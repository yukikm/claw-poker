import { Connection } from '@solana/web3.js';
import { SOLANA_RPC_URL, SOLANA_WS_URL, MAGICBLOCK_ER_RPC_URL, MAGICBLOCK_ER_WS_URL } from './constants';

let connectionInstance: Connection | null = null;

export function getConnection(): Connection {
  if (!connectionInstance) {
    connectionInstance = new Connection(SOLANA_RPC_URL, {
      commitment: 'confirmed',
      wsEndpoint: SOLANA_WS_URL,
    });
  }
  return connectionInstance;
}

let erConnectionInstance: Connection | null = null;

export function getERConnection(): Connection {
  if (!erConnectionInstance) {
    erConnectionInstance = new Connection(MAGICBLOCK_ER_RPC_URL, {
      commitment: 'confirmed',
      wsEndpoint: MAGICBLOCK_ER_WS_URL,
    });
  }
  return erConnectionInstance;
}
