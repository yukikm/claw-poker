'use client';

import { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { formatAddress } from '@/lib/format';

export function WalletButton() {
  const { connection } = useConnection();
  const { publicKey, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setBalance(null);
      return;
    }

    let cancelled = false;

    connection.getBalance(publicKey).then((lamports) => {
      if (!cancelled) setBalance(lamports);
    }).catch(() => {
      if (!cancelled) setBalance(null);
    });

    const subId = connection.onAccountChange(
      publicKey,
      (accountInfo) => { setBalance(accountInfo.lamports); },
      'confirmed'
    );

    return () => {
      cancelled = true;
      connection.removeAccountChangeListener(subId);
    };
  }, [connection, publicKey]);

  if (connected && publicKey) {
    return (
      <div className="flex items-center gap-2">
        <div className="glass rounded-lg px-3 py-2 text-sm">
          <span className="text-slate-400 text-xs">接続済み</span>
          <p className="text-cyan-400 font-mono">{formatAddress(publicKey)}</p>
          {balance !== null && (
            <p className="text-slate-300 text-xs font-mono">
              {(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL
            </p>
          )}
        </div>
        <button
          onClick={disconnect}
          className="glass rounded-lg px-3 py-2 text-sm text-slate-300 hover:text-white hover:border-red-500/30 transition-colors cursor-pointer"
          aria-label="ウォレットを切断"
        >
          切断
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setVisible(true)}
      className="glass-cyan rounded-lg px-4 py-2 text-sm font-semibold text-cyan-300 hover:text-white hover:shadow-neon-cyan transition-all duration-200 cursor-pointer"
      aria-label="ウォレットを接続"
    >
      ウォレット接続
    </button>
  );
}
