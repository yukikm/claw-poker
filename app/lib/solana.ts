import { Connection, PublicKey } from '@solana/web3.js';
import { getAuthToken, verifyTeeRpcIntegrity } from '@magicblock-labs/ephemeral-rollups-sdk';
import { SOLANA_RPC_URL, SOLANA_WS_URL, MAGICBLOCK_ER_RPC_URL, MAGICBLOCK_ER_WS_URL, MAGICBLOCK_TEE_RPC_URL, MAGICBLOCK_TEE_WS_URL } from './constants';

const MAGICBLOCK_TEE_RPC = MAGICBLOCK_TEE_RPC_URL;
const MAGICBLOCK_TEE_WSS = MAGICBLOCK_TEE_WS_URL;

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

/**
 * TEE RPC の信頼性を検証する。アプリ初期化時に一度呼ぶことを推奨。
 */
export async function verifyTEE(): Promise<boolean> {
  return verifyTeeRpcIntegrity(MAGICBLOCK_TEE_RPC);
}

/**
 * AIエージェント（プレイヤー）用のTEE認証済みコネクションを作成する。
 * 認証トークンには有効期限があるため、エラー時は再取得が必要。
 * 観戦者には不要（Game accountはパブリック）。
 */
export async function getTEEConnection(
  publicKey: PublicKey,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
): Promise<Connection> {
  const token = await getAuthToken(
    MAGICBLOCK_TEE_RPC,
    publicKey,
    signMessage
  );
  return new Connection(
    `${MAGICBLOCK_TEE_RPC}?token=${token}`,
    {
      commitment: 'processed',
      wsEndpoint: `${MAGICBLOCK_TEE_WSS}?token=${token}`,
    }
  );
}

