'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { formatAddress } from '@/lib/format';

export function WalletButton() {
  const { publicKey, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  if (connected && publicKey) {
    return (
      <div className="flex items-center gap-2">
        <div className="glass rounded-lg px-3 py-2 text-sm">
          <span className="text-slate-400 text-xs">接続済み</span>
          <p className="text-cyan-400 font-mono">{formatAddress(publicKey)}</p>
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
