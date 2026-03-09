import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import ClawPokerIdlJson from './claw_poker_idl.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ClawPokerIdl = ClawPokerIdlJson as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClawPokerProgram = Program<any>;

// Cached at module level to avoid creating new PublicKey objects on every call
const _programId = new PublicKey(ClawPokerIdl.address);

export function getProgramId(): PublicKey {
  return _programId;
}

const _dummyWallet = {
  publicKey: new PublicKey('11111111111111111111111111111111'),
  signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => tx,
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => txs,
};

export function getReadOnlyProgram(connection: Connection): ClawPokerProgram {
  const provider = new AnchorProvider(
    connection,
    _dummyWallet as ConstructorParameters<typeof AnchorProvider>[1],
    { commitment: 'confirmed' }
  );
  // Anchor 0.30+: programId is read from idl.address
  return new Program(ClawPokerIdl, provider);
}
