/**
 * Tests for deep link URL parsing logic.
 *
 * The DeepLinkHandler component in app/_layout.tsx uses Linking.parse()
 * to extract path and queryParams, then routes accordingly:
 *   - "game" + id param  -> /games/{id}
 *   - "bets"             -> /my-bets
 *   - "settings"         -> /settings
 *
 * Since we cannot render React components (no @testing-library/react-native),
 * we test the parsing and routing logic as pure functions.
 */

import * as Linking from 'expo-linking';

const mockParse = Linking.parse as jest.Mock;

/** Simulates the parsing logic from DeepLinkHandler */
function parseDeepLink(url: string): { route: string | null; params: Record<string, string> } {
  const parsed = Linking.parse(url);
  const path = parsed.path?.replace(/^\//, '') ?? '';
  const queryParams = (parsed.queryParams ?? {}) as Record<string, string>;

  if (path === 'game' && queryParams.id) {
    return { route: `/games/${queryParams.id}`, params: queryParams };
  } else if (path === 'bets') {
    return { route: '/my-bets', params: queryParams };
  } else if (path === 'settings') {
    return { route: '/settings', params: queryParams };
  }
  return { route: null, params: queryParams };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('deep link URL parsing', () => {
  describe('clawpoker://game?id=XXX', () => {
    it('parses game deep link with id correctly', () => {
      mockParse.mockReturnValueOnce({
        path: 'game',
        queryParams: { id: 'abc123' },
      });

      const result = parseDeepLink('clawpoker://game?id=abc123');
      expect(result.route).toBe('/games/abc123');
      expect(result.params.id).toBe('abc123');
    });

    it('handles numeric game id', () => {
      mockParse.mockReturnValueOnce({
        path: 'game',
        queryParams: { id: '42' },
      });

      const result = parseDeepLink('clawpoker://game?id=42');
      expect(result.route).toBe('/games/42');
    });

    it('returns null route when game path has no id', () => {
      mockParse.mockReturnValueOnce({
        path: 'game',
        queryParams: {},
      });

      const result = parseDeepLink('clawpoker://game');
      expect(result.route).toBeNull();
    });
  });

  describe('clawpoker://bets', () => {
    it('parses bets deep link correctly', () => {
      mockParse.mockReturnValueOnce({
        path: 'bets',
        queryParams: {},
      });

      const result = parseDeepLink('clawpoker://bets');
      expect(result.route).toBe('/my-bets');
    });
  });

  describe('clawpoker://settings', () => {
    it('parses settings deep link correctly', () => {
      mockParse.mockReturnValueOnce({
        path: 'settings',
        queryParams: {},
      });

      const result = parseDeepLink('clawpoker://settings');
      expect(result.route).toBe('/settings');
    });
  });

  describe('invalid URLs handled gracefully', () => {
    it('returns null route for unknown path', () => {
      mockParse.mockReturnValueOnce({
        path: 'unknown-path',
        queryParams: {},
      });

      const result = parseDeepLink('clawpoker://unknown-path');
      expect(result.route).toBeNull();
    });

    it('returns null route for empty path', () => {
      mockParse.mockReturnValueOnce({
        path: '',
        queryParams: {},
      });

      const result = parseDeepLink('clawpoker://');
      expect(result.route).toBeNull();
    });

    it('returns null route when parse returns null path', () => {
      mockParse.mockReturnValueOnce({
        path: null,
        queryParams: {},
      });

      const result = parseDeepLink('');
      expect(result.route).toBeNull();
    });

    it('returns null route when parse returns undefined queryParams', () => {
      mockParse.mockReturnValueOnce({
        path: 'game',
        queryParams: undefined,
      });

      const result = parseDeepLink('clawpoker://game');
      expect(result.route).toBeNull(); // game without id
    });
  });

  describe('path with leading slash is normalized', () => {
    it('strips leading slash from path', () => {
      mockParse.mockReturnValueOnce({
        path: '/bets',
        queryParams: {},
      });

      const result = parseDeepLink('clawpoker:///bets');
      expect(result.route).toBe('/my-bets');
    });

    it('strips leading slash from game path', () => {
      mockParse.mockReturnValueOnce({
        path: '/game',
        queryParams: { id: 'xyz' },
      });

      const result = parseDeepLink('clawpoker:///game?id=xyz');
      expect(result.route).toBe('/games/xyz');
    });

    it('strips leading slash from settings path', () => {
      mockParse.mockReturnValueOnce({
        path: '/settings',
        queryParams: {},
      });

      const result = parseDeepLink('clawpoker:///settings');
      expect(result.route).toBe('/settings');
    });
  });

  describe('Linking.parse is called with the URL', () => {
    it('delegates to Linking.parse', () => {
      mockParse.mockReturnValueOnce({ path: 'bets', queryParams: {} });

      parseDeepLink('clawpoker://bets');
      expect(mockParse).toHaveBeenCalledWith('clawpoker://bets');
    });
  });
});
