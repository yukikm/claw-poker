'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletButton } from '@/components/wallet/WalletButton';

const NAV_LINKS = [
  { href: '/', label: 'ホーム' },
  { href: '/games', label: 'ゲーム一覧' },
  { href: '/my-bets', label: 'マイベット' },
  { href: '/leaderboard', label: 'ランキング' },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-3 glass-dark border-b border-white/5">
      <Link href="/" className="flex items-center gap-2" aria-label="Claw Poker ホーム">
        <div className="w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-cyan-400" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path d="M4 5h16M4 12h16M4 19h16" strokeLinecap="round" />
          </svg>
        </div>
        <span className="text-lg font-bold neon-text-cyan text-cyan-300">Claw Poker</span>
      </Link>

      <nav aria-label="メインナビゲーション">
        <ul className="flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className={`px-3 py-2 rounded-lg text-sm transition-colors duration-200 ${
                  pathname === href
                    ? 'glass-cyan text-cyan-300 font-medium'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
                aria-current={pathname === href ? 'page' : undefined}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <WalletButton />
    </header>
  );
}
