import { PublicKey } from '@solana/web3.js';
import { LAMPORTS_PER_SOL, CARD_SUITS, CARD_RANKS, CARD_UNKNOWN } from './constants';
import { CardDisplay } from './types';

export function formatSol(lamports: number, decimals = 3): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(decimals);
}

export function formatAddress(address: PublicKey | string, chars = 4): string {
  const str = address.toString();
  return `${str.slice(0, chars)}...${str.slice(-chars)}`;
}

export function decodeCard(cardByte: number): CardDisplay {
  if (cardByte === CARD_UNKNOWN) {
    return { suit: 'Spades', rank: 0, isUnknown: true };
  }
  const suit = CARD_SUITS[Math.floor(cardByte / 13)] ?? 'Spades';
  const rank = cardByte % 13;
  return { suit, rank, isUnknown: false };
}

export function cardDisplayString(card: CardDisplay): string {
  if (card.isUnknown) return '??';
  const rankStr = CARD_RANKS[card.rank] ?? '?';
  const suitSymbol = {
    Spades: '♠',
    Hearts: '♥',
    Diamonds: '♦',
    Clubs: '♣',
  }[card.suit];
  return `${rankStr}${suitSymbol}`;
}

export function formatOdds(totalBetA: number, totalBetB: number): { odds1: string; odds2: string } {
  const total = totalBetA + totalBetB;
  if (total === 0) return { odds1: '1.00', odds2: '1.00' };
  const odds1 = totalBetA > 0 ? (total / totalBetA).toFixed(2) : '---';
  const odds2 = totalBetB > 0 ? (total / totalBetB).toFixed(2) : '---';
  return { odds1, odds2 };
}

export function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString('ja-JP');
}
