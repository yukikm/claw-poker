import { formatSol, formatAddress, decodeCard, cardDisplayString, formatOdds } from '../lib/format';
import { PublicKey } from '@solana/web3.js';

describe('formatSol', () => {
  it('converts lamports to SOL with 3 decimal places by default', () => {
    expect(formatSol(1_000_000_000)).toBe('1.000');
    expect(formatSol(500_000_000)).toBe('0.500');
    expect(formatSol(100_000_000)).toBe('0.100');
  });

  it('handles zero', () => {
    expect(formatSol(0)).toBe('0.000');
  });

  it('respects custom decimals', () => {
    expect(formatSol(1_234_567_890, 2)).toBe('1.23');
  });
});

describe('formatAddress', () => {
  it('truncates PublicKey to short form', () => {
    const key = new PublicKey('6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo');
    const formatted = formatAddress(key);
    expect(formatted).toBe('6fSv...CCAo');
  });

  it('accepts string address', () => {
    const formatted = formatAddress('6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo', 6);
    expect(formatted).toBe('6fSvbY...7QCCAo');
  });
});

describe('decodeCard', () => {
  it('decodes valid card byte', () => {
    const card = decodeCard(0); // 2 of Spades
    expect(card.suit).toBe('Spades');
    expect(card.rank).toBe(0);
    expect(card.isUnknown).toBe(false);
  });

  it('decodes unknown card (255)', () => {
    const card = decodeCard(255);
    expect(card.isUnknown).toBe(true);
  });

  it('decodes Ace of Hearts (13*3 + 12 = 51)', () => {
    const card = decodeCard(51);
    expect(card.suit).toBe('Hearts');
    expect(card.rank).toBe(12);
  });
});

describe('cardDisplayString', () => {
  it('renders known card', () => {
    expect(cardDisplayString({ suit: 'Spades', rank: 0, isUnknown: false })).toBe('2\u2660');
    expect(cardDisplayString({ suit: 'Hearts', rank: 12, isUnknown: false })).toBe('A\u2665');
  });

  it('renders unknown card', () => {
    expect(cardDisplayString({ suit: 'Spades', rank: 0, isUnknown: true })).toBe('??');
  });
});

describe('formatOdds', () => {
  it('calculates odds correctly', () => {
    const { odds1, odds2 } = formatOdds(100, 200);
    expect(odds1).toBe('3.00');
    expect(odds2).toBe('1.50');
  });

  it('handles zero total', () => {
    const { odds1, odds2 } = formatOdds(0, 0);
    expect(odds1).toBe('1.00');
    expect(odds2).toBe('1.00');
  });

  it('handles one-sided bet', () => {
    const { odds1, odds2 } = formatOdds(100, 0);
    expect(odds1).toBe('1.00');
    expect(odds2).toBe('---');
  });
});
