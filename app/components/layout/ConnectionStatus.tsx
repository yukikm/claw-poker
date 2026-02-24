'use client';

import { useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';

export function ConnectionStatus() {
  const { connection } = useConnection();
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function checkConnection() {
      connection.getSlot('confirmed').then(() => {
        setIsDisconnected(false);
        setIsReconnecting(false);
      }).catch(() => {
        setIsDisconnected(true);
        // 自動再接続を試行
        setIsReconnecting(true);
        reconnectTimer = setTimeout(checkConnection, 5000);
      });
    }

    // 30秒間隔でヘルスチェック
    const healthCheck = setInterval(checkConnection, 30000);

    return () => {
      clearInterval(healthCheck);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [connection]);

  if (!isDisconnected) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 glass rounded-xl border border-yellow-500/30 px-4 py-3 flex items-center gap-3 shadow-lg"
      role="alert"
      aria-live="assertive"
    >
      <div className="w-2.5 h-2.5 rounded-full bg-yellow-400 animate-pulse" aria-hidden="true" />
      <p className="text-sm text-yellow-300">
        {isReconnecting
          ? 'ネットワーク接続を再試行中...'
          : 'ネットワーク接続が切断されました'}
      </p>
    </div>
  );
}
