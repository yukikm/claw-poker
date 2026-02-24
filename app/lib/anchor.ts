'use client';

import { useMemo } from 'react';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { type ClawPoker } from '../../target/types/claw_poker';
import ClawPokerIdlJson from './claw_poker_idl.json';
import { PROGRAM_ID } from './constants';

export type { ClawPoker };

export const ClawPokerIdl = ClawPokerIdlJson as ClawPoker;

export type ClawPokerProgram = Program<ClawPoker>;

export function useAnchorProgram(): ClawPokerProgram | null {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    if (!wallet) return null;

    const provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
    });

    return new Program(ClawPokerIdl, provider);
  }, [connection, wallet]);
}

export function getProgramId(): PublicKey {
  return new PublicKey(PROGRAM_ID);
}

// ウォレット不要な読み取り専用プログラムインスタンスを生成する
// アカウントフェッチ・Anchorコーダーによるデコードに使用する
const _dummyWallet = {
  publicKey: new PublicKey('11111111111111111111111111111111'),
  signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => tx,
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => txs,
};

export function getReadOnlyProgram(connection: Connection): ClawPokerProgram {
  const provider = new AnchorProvider(connection, _dummyWallet as ConstructorParameters<typeof AnchorProvider>[1], {
    commitment: 'confirmed',
  });
  return new Program(ClawPokerIdl, provider);
}
