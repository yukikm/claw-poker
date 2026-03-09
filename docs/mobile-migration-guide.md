# Claw Poker: React Native (Expo) Mobile Migration Guide

## Overview

Next.js 14 Web アプリケーションを Expo (React Native) に移行し、Solana Mobile (Android) 対応のネイティブアプリとして再構築する。iOS は対象外。

### Goal

- Android ネイティブアプリとして観戦 + ベッティング機能を提供
- Mobile Wallet Adapter (MWA) による Phantom/Solflare 接続
- 既存サーバー (`server/`) はそのまま利用（変更不要）
- Solana プログラム (`programs/`) も変更不要

### Scope

| In Scope | Out of Scope |
|----------|-------------|
| Expo プロジェクト新規作成 (`mobile/`) | iOS 対応 |
| MWA ウォレット接続 | AI エージェント機能 (サーバー側) |
| ゲーム観戦 UI | Solana プログラム変更 |
| ベッティング機能 | サーバー側変更 |
| リアルタイムゲーム状態表示 | Web フロントエンド変更 |

---

## Architecture

```
mobile/                          # 新規 Expo プロジェクト
├── app/                         # Expo Router (file-based routing)
│   ├── _layout.tsx              # Root layout (providers, navigation)
│   ├── index.tsx                # Home (game list + stats)
│   ├── games/
│   │   ├── index.tsx            # Games list with filters
│   │   └── [gameId].tsx         # Game detail (PokerTable + Betting)
│   ├── my-bets.tsx              # User's bet history
│   └── leaderboard.tsx          # Agent rankings
├── components/
│   ├── poker/
│   │   ├── PokerTable.tsx       # Main game table view
│   │   ├── HoleCards.tsx        # Player cards
│   │   ├── CommunityCards.tsx   # Board cards (5 slots)
│   │   ├── PlayingCard.tsx      # Single card rendering
│   │   ├── ChipStack.tsx        # Chip display
│   │   ├── PotDisplay.tsx       # Pot amount
│   │   ├── PhaseIndicator.tsx   # Game phase badge
│   │   └── ActionBadge.tsx      # Player action display
│   ├── game/
│   │   ├── GameCard.tsx         # Game summary card
│   │   ├── GameList.tsx         # Game list with FlatList
│   │   ├── GameStatusBadge.tsx  # Status badge
│   │   └── AgentInfo.tsx        # Agent display
│   ├── betting/
│   │   ├── BettingPanel.tsx     # Bet placement UI
│   │   ├── OddsDisplay.tsx      # Odds display
│   │   └── ClaimButton.tsx      # Claim reward
│   ├── wallet/
│   │   └── WalletButton.tsx     # Connect/disconnect + balance
│   └── ui/
│       ├── GlassCard.tsx        # Glassmorphism card
│       ├── NeonText.tsx         # Glow text
│       └── LoadingSkeleton.tsx  # Loading placeholder
├── providers/
│   ├── WalletProvider.tsx       # MWA wallet context
│   └── ConnectionProvider.tsx   # Solana connection context
├── hooks/
│   ├── useWallet.ts             # Wallet state hook (MWA wrapper)
│   ├── useGameSubscription.ts   # Game state subscription
│   ├── usePlaceBet.ts           # Bet transaction
│   └── useClaimReward.ts        # Claim transaction
├── stores/
│   ├── gamesStore.ts            # Game list (from web, minimal changes)
│   ├── watchGameStore.ts        # Game detail (from web, polling-based)
│   └── myBetsStore.ts           # User bets (from web, as-is)
├── lib/
│   ├── constants.ts             # Constants (from web, env var prefix change)
│   ├── solana.ts                # Connection managers (from web, as-is)
│   ├── anchor.ts                # Anchor program (adapted for MWA)
│   ├── types.ts                 # Type definitions (from web, as-is)
│   ├── format.ts                # Formatters (from web, as-is)
│   └── polyfills.ts             # Crypto/Buffer polyfills
├── assets/
│   ├── cards/                   # Card images (PNG)
│   └── fonts/                   # Custom fonts
├── app.json                     # Expo config
├── metro.config.js              # Metro bundler config (polyfills)
├── package.json
└── tsconfig.json
```

---

## Phase 1: Project Bootstrap

### 1.1 Expo プロジェクト初期化

```bash
cd /Users/yukikimura/work/claw-poker
npx create-expo-app mobile --template blank-typescript
cd mobile
```

### 1.2 Dependencies

```bash
# Core Expo
npx expo install expo-router expo-dev-client expo-secure-store expo-crypto expo-linking

# Solana Core
npm install @solana/web3.js @coral-xyz/anchor@0.28.0

# MagicBlock
npm install @magicblock-labs/ephemeral-rollups-sdk

# Mobile Wallet Adapter (Android)
npm install @solana-mobile/mobile-wallet-adapter-protocol @solana-mobile/mobile-wallet-adapter-protocol-web3js

# Polyfills (CRITICAL)
npm install react-native-quick-crypto react-native-url-polyfill @craftzdog/react-native-buffer

# State Management
npm install zustand

# UI
npm install react-native-reanimated expo-linear-gradient expo-blur @expo/vector-icons
npm install @react-native-community/netinfo
npm install react-native-gesture-handler react-native-safe-area-context

# NativeWind (Tailwind for RN) - optional but recommended
npm install nativewind tailwindcss

# Navigation (if not using expo-router)
# npm install @react-navigation/native @react-navigation/stack
```

**Anchor バージョン注意:** `@coral-xyz/anchor` は **0.28.0 に固定**。0.29+ は React Native のポリフィルチェーンと非互換。

### 1.3 Polyfill Setup

```typescript
// mobile/lib/polyfills.ts
// MUST be imported FIRST in the entry file, before any Solana imports

import 'react-native-quick-crypto/shim';  // patches global.crypto
import 'react-native-url-polyfill/auto';
import { Buffer } from '@craftzdog/react-native-buffer';

global.Buffer = Buffer as unknown as typeof globalThis.Buffer;
```

```typescript
// mobile/app/_layout.tsx (entry point)
import '../lib/polyfills';  // FIRST LINE - before all other imports
// ... rest of imports
```

### 1.4 Metro Config

```javascript
// mobile/metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  crypto: require.resolve('react-native-quick-crypto'),
};

module.exports = config;
```

### 1.5 app.json

```json
{
  "expo": {
    "name": "Claw Poker",
    "slug": "claw-poker",
    "version": "1.0.0",
    "scheme": "clawpoker",
    "orientation": "portrait",
    "platforms": ["android"],
    "android": {
      "package": "com.clawpoker.app",
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#0A0E1A"
      },
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [{ "scheme": "clawpoker" }],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    },
    "plugins": [
      "expo-router",
      "expo-secure-store",
      "expo-crypto"
    ]
  }
}
```

### 1.6 環境変数

```bash
# mobile/.env
EXPO_PUBLIC_SOLANA_NETWORK=devnet
EXPO_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
EXPO_PUBLIC_SOLANA_WS_URL=wss://api.devnet.solana.com
EXPO_PUBLIC_SERVER_API_URL=http://43.206.193.46:3001
EXPO_PUBLIC_MAGICBLOCK_ER_RPC_URL=https://devnet.magicblock.app
EXPO_PUBLIC_MAGICBLOCK_ER_WS_URL=wss://devnet.magicblock.app
EXPO_PUBLIC_MAGICBLOCK_TEE_RPC_URL=https://tee.magicblock.app
EXPO_PUBLIC_MAGICBLOCK_TEE_WS_URL=wss://tee.magicblock.app
```

### 1.7 ビルド・起動

```bash
# Development build (Expo Go は使用不可)
npx expo run:android

# または EAS Build
eas build --profile development --platform android
```

---

## Phase 2: Wallet Integration (MWA)

### 2.1 WalletProvider

Web 版 (`app/providers/WalletProvider.tsx`) を MWA ベースに置き換える。

**Web (現行):**
```typescript
// @solana/wallet-adapter-react の ConnectionProvider + WalletProvider + WalletModalProvider
```

**Mobile (新規):**

```typescript
// mobile/providers/WalletProvider.tsx
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { transact, Web3MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import * as SecureStore from 'expo-secure-store';

interface WalletContextType {
  publicKey: PublicKey | null;
  connected: boolean;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
  signAndSendTransaction: (tx: Transaction | VersionedTransaction) => Promise<string>;
}

const WalletContext = createContext<WalletContextType>(/* ... */);

export function MobileWalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const APP_IDENTITY = {
    name: 'Claw Poker',
    uri: 'https://claw-poker.com',
    icon: 'favicon.ico',
  };

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const result = await transact(async (wallet: Web3MobileWallet) => {
        const auth = await wallet.authorize({
          cluster: 'devnet',
          identity: APP_IDENTITY,
        });
        return auth;
      });
      setPublicKey(new PublicKey(result.accounts[0].address));
      setAuthToken(result.auth_token);
      await SecureStore.setItemAsync('wallet_auth_token', result.auth_token);
    } finally {
      setConnecting(false);
    }
  }, []);

  const signAndSendTransaction = useCallback(async (tx: Transaction | VersionedTransaction) => {
    return await transact(async (wallet: Web3MobileWallet) => {
      // Reauthorize with cached token
      if (authToken) {
        await wallet.authorize({
          cluster: 'devnet',
          identity: APP_IDENTITY,
          auth_token: authToken,
        });
      }
      const signatures = await wallet.signAndSendTransactions({
        transactions: [tx],
      });
      return signatures[0]; // base64 signature
    });
  }, [authToken]);

  // ... disconnect, signTransaction implementations

  return (
    <WalletContext.Provider value={{
      publicKey, connected: !!publicKey, connecting,
      connect, disconnect, signTransaction, signAndSendTransaction,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => useContext(WalletContext);
```

### 2.2 WalletButton

```typescript
// mobile/components/wallet/WalletButton.tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useWallet } from '@/providers/WalletProvider';
import { formatAddress, formatSol } from '@/lib/format';

export function WalletButton() {
  const { publicKey, connected, connecting, connect, disconnect } = useWallet();
  // balance fetch via useEffect + connection.getBalance()

  if (!connected) {
    return (
      <Pressable style={styles.connectButton} onPress={connect} disabled={connecting}>
        <Text style={styles.buttonText}>
          {connecting ? 'Connecting...' : 'Connect Wallet'}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.connectedContainer}>
      <Text style={styles.address}>{formatAddress(publicKey!.toString())}</Text>
      <Text style={styles.balance}>{formatSol(balance)} SOL</Text>
      <Pressable onPress={disconnect}>
        <Text style={styles.disconnectText}>Disconnect</Text>
      </Pressable>
    </View>
  );
}
```

### 2.3 Anchor Program Integration

Web 版 `useAnchorProgram()` は `useWallet()` から wallet を取得するが、MWA では `transact()` のコールバック内でしか signing できない。

**アプローチ:** Read-only program + 送信時のみ `transact()` 使用

```typescript
// mobile/lib/anchor.ts
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { Connection, Keypair } from '@solana/web3.js';
import { ClawPokerIdl } from './claw_poker_idl';
import { getConnection } from './solana';
import { PROGRAM_ID } from './constants';

// Read-only program (game state 取得用)
export function getReadOnlyProgram(): Program<typeof ClawPokerIdl> {
  const connection = getConnection();
  const dummyWallet = {
    publicKey: Keypair.generate().publicKey,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any) => txs,
  };
  const provider = new AnchorProvider(connection, dummyWallet, {
    commitment: 'confirmed',
  });
  return new Program(ClawPokerIdl, PROGRAM_ID, provider);
}

// Transaction building (signing は MWA transact() 内で行う)
export function buildPlaceBetInstruction(/* params */) {
  const program = getReadOnlyProgram();
  // return program.methods.placeBet(...).instruction();
}
```

---

## Phase 3: State Management Migration

### 3.1 移植方針

| Store | 変更量 | 内容 |
|-------|--------|------|
| `gamesStore.ts` | 小 | `NEXT_PUBLIC_*` → `EXPO_PUBLIC_*`、import path 変更のみ |
| `watchGameStore.ts` | 中 | `onAccountChange` → polling ベースに変更 |
| `myBetsStore.ts` | 小 | import path 変更のみ |

### 3.2 gamesStore.ts 移植手順

Web 版 (`app/stores/gamesStore.ts`, 261行) をコピーし、以下を変更:

1. Import path: `@/lib/*` → `../lib/*` (Expo Router の alias に合わせる)
2. 環境変数: `process.env.NEXT_PUBLIC_SERVER_API_URL` → `process.env.EXPO_PUBLIC_SERVER_API_URL`
3. `setInterval` → そのまま使用可 (RN でも動作する)

### 3.3 watchGameStore.ts 移植手順

Web 版 (`app/stores/watchGameStore.ts`, 557行) をコピーし、以下を変更:

1. **`connection.onAccountChange()` の置き換え:**

Web 版では WebSocket ベースの `onAccountChange` でリアルタイム更新を受信している。React Native では OS によるバックグラウンド制限があるため、**polling ベース**に変更する。

```typescript
// Web (現行)
const subscriptionId = connection.onAccountChange(
  gamePda,
  (accountInfo) => { /* handle update */ },
  'confirmed'
);
// cleanup: connection.removeAccountChangeListener(subscriptionId)

// Mobile (新規)
let pollingTimer: ReturnType<typeof setInterval> | null = null;

function startGamePolling(gamePda: PublicKey, connection: Connection) {
  pollingTimer = setInterval(async () => {
    try {
      const accountInfo = await connection.getAccountInfo(gamePda, 'confirmed');
      if (accountInfo) {
        handleGameAccountUpdate(accountInfo);
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 2000); // 2秒間隔
}

function stopGamePolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}
```

2. **AppState 対応 (バックグラウンド/フォアグラウンド):**

```typescript
import { AppState } from 'react-native';

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    // フォアグラウンド復帰 → polling 再開
    startGamePolling(currentGamePda, connection);
  } else {
    // バックグラウンド → polling 停止 (バッテリー節約)
    stopGamePolling();
  }
});
```

3. **ネットワーク変更対応:**

```typescript
import NetInfo from '@react-native-community/netinfo';

NetInfo.addEventListener((state) => {
  if (state.isConnected && currentGamePda) {
    startGamePolling(currentGamePda, connection);
  } else {
    stopGamePolling();
  }
});
```

### 3.4 lib/ ファイル移植

| ファイル | 変更内容 |
|---------|---------|
| `constants.ts` | `NEXT_PUBLIC_*` → `EXPO_PUBLIC_*` のみ |
| `solana.ts` | 変更なし (Connection クラスは RN 互換) |
| `types.ts` | 変更なし (純粋な TypeScript 型定義) |
| `format.ts` | 変更なし (純粋な関数) |
| `anchor.ts` | Phase 2.3 参照。hook → 関数ベースに変更 |
| `claw_poker_idl.json` | コピーのみ |

---

## Phase 4: UI Implementation

### 4.1 Design System Mapping

Web の Glassmorphism デザインを React Native で再現する。

```typescript
// mobile/components/ui/GlassCard.tsx
import { View, StyleSheet, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

interface GlassCardProps {
  children: React.ReactNode;
  variant?: 'default' | 'cyan' | 'purple';
  style?: ViewStyle;
}

export function GlassCard({ children, variant = 'default', style }: GlassCardProps) {
  const borderColor = {
    default: 'rgba(255,255,255,0.1)',
    cyan: 'rgba(6,182,212,0.3)',
    purple: 'rgba(139,92,246,0.3)',
  }[variant];

  return (
    <View style={[styles.container, { borderColor }, style]}>
      <BlurView intensity={12} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.02)']}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  content: {
    padding: 16,
  },
});
```

### 4.2 Color Palette

```typescript
// mobile/lib/theme.ts
export const colors = {
  bg: {
    primary: '#0A0E1A',
    secondary: '#111827',
    card: 'rgba(17, 24, 39, 0.8)',
  },
  cyan: {
    DEFAULT: '#06B6D4',
    light: '#22D3EE',
    dark: '#0891B2',
    glow: 'rgba(6, 182, 212, 0.4)',
  },
  purple: {
    DEFAULT: '#8B5CF6',
    light: '#A78BFA',
    dark: '#7C3AED',
    glow: 'rgba(139, 92, 246, 0.4)',
  },
  text: {
    primary: '#F9FAFB',
    secondary: '#9CA3AF',
    muted: '#6B7280',
  },
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
};
```

### 4.3 Component Migration Map

各コンポーネントの Web → Mobile 対応表:

| Web Component | Mobile Component | Key Changes |
|---------------|-----------------|-------------|
| `PokerTable.tsx` (169行) | `poker/PokerTable.tsx` | CSS grid → Flexbox, radial-gradient → LinearGradient, SVG → expo-vector-icons |
| `HoleCards.tsx` | `poker/HoleCards.tsx` | CSS card sprites → Image/View ベース |
| `CommunityCards.tsx` | `poker/CommunityCards.tsx` | Flex row レイアウト |
| `PlayingCard` (新規) | `poker/PlayingCard.tsx` | カード1枚の描画 (View + Text で構築) |
| `ChipStack.tsx` | `poker/ChipStack.tsx` | Text + icon |
| `PotDisplay.tsx` | `poker/PotDisplay.tsx` | Text のみ |
| `PhaseIndicator.tsx` | `poker/PhaseIndicator.tsx` | Badge component |
| `ActionBadge.tsx` | `poker/ActionBadge.tsx` | Badge component |
| `GameCard.tsx` (85行) | `game/GameCard.tsx` | `next/link` → `router.push()`, Pressable |
| `GameList.tsx` (99行) | `game/GameList.tsx` | CSS grid → `FlatList` with `numColumns` |
| `BettingPanel.tsx` (209行) | `betting/BettingPanel.tsx` | `<input>` → `TextInput`, range → Slider |
| `WalletButton.tsx` (73行) | `wallet/WalletButton.tsx` | wallet-adapter → MWA (Phase 2.2) |
| `Header.tsx` | Expo Router header config | Stack.Screen options |
| `ConnectionStatus.tsx` | `ui/ConnectionStatus.tsx` | View + Text |

### 4.4 PokerTable Layout (Mobile)

```
┌─────────────────────────────┐
│        Phase Indicator       │
├─────────────────────────────┤
│  ┌───────────────────────┐  │
│  │    Player 2 (Top)     │  │
│  │  Avatar | Name | Chips│  │
│  │     [Card] [Card]     │  │
│  └───────────────────────┘  │
│                             │
│    [C1] [C2] [C3] [C4] [C5]│  ← Community Cards
│         Pot: 2.5 SOL        │
│                             │
│  ┌───────────────────────┐  │
│  │    Player 1 (Bottom)  │  │
│  │  Avatar | Name | Chips│  │
│  │     [Card] [Card]     │  │
│  └───────────────────────┘  │
├─────────────────────────────┤
│      Betting Panel          │
│  [P1 btn] [P2 btn]         │
│  Amount: [___] SOL          │
│  [0.1] [0.5] [1.0] [5.0]   │
│  [Place Bet]                │
└─────────────────────────────┘
```

### 4.5 Navigation Structure

```typescript
// mobile/app/_layout.tsx
import '../lib/polyfills';
import { Stack } from 'expo-router';
import { MobileWalletProvider } from '../providers/WalletProvider';
import { ConnectionProvider } from '../providers/ConnectionProvider';
import { colors } from '../lib/theme';

export default function RootLayout() {
  return (
    <ConnectionProvider>
      <MobileWalletProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg.primary },
            headerTintColor: colors.text.primary,
            contentStyle: { backgroundColor: colors.bg.primary },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Claw Poker' }} />
          <Stack.Screen name="games/index" options={{ title: 'Games' }} />
          <Stack.Screen name="games/[gameId]" options={{ title: 'Watch Game' }} />
          <Stack.Screen name="my-bets" options={{ title: 'My Bets' }} />
          <Stack.Screen name="leaderboard" options={{ title: 'Leaderboard' }} />
        </Stack>
      </MobileWalletProvider>
    </ConnectionProvider>
  );
}
```

### 4.6 Animation Migration

| Web (Framer Motion) | Mobile (Reanimated) |
|---------------------|---------------------|
| `motion.div` with `initial`/`animate` | `Animated.View` with `useAnimatedStyle` |
| `AnimatePresence` | `Animated.View` with `entering`/`exiting` |
| Card flip: `rotateY` transform | `withTiming` + `rotateY` |
| Cascade entrance: `staggerChildren` | `FadeIn.delay(index * 100)` |
| Chip float: CSS `@keyframes` | `withRepeat(withSequence(...))` |

---

## Phase 5: Mobile-Specific Features

### 5.1 AppState / Network Reconnection

```typescript
// mobile/hooks/useAppStateReconnect.ts
import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

export function useAppStateReconnect(onReconnect: () => void) {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const appSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current.match(/background/) && nextState === 'active') {
        onReconnect();
      }
      appState.current = nextState;
    });

    const netSub = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        onReconnect();
      }
    });

    return () => {
      appSub.remove();
      netSub();
    };
  }, [onReconnect]);
}
```

### 5.2 Auth Token Persistence

```typescript
// MWA auth_token を SecureStore に保存
import * as SecureStore from 'expo-secure-store';

const AUTH_TOKEN_KEY = 'mwa_auth_token';
const WALLET_ADDRESS_KEY = 'wallet_address';

export async function saveWalletSession(authToken: string, address: string): Promise<void> {
  await SecureStore.setItemAsync(AUTH_TOKEN_KEY, authToken);
  await SecureStore.setItemAsync(WALLET_ADDRESS_KEY, address);
}

export async function loadWalletSession(): Promise<{ authToken: string; address: string } | null> {
  const authToken = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
  const address = await SecureStore.getItemAsync(WALLET_ADDRESS_KEY);
  if (authToken && address) {
    return { authToken, address };
  }
  return null;
}

export async function clearWalletSession(): Promise<void> {
  await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
  await SecureStore.deleteItemAsync(WALLET_ADDRESS_KEY);
}
```

### 5.3 Server API Polling (WebSocket 代替)

モバイルではバックグラウンド制限により、WebSocket よりも HTTP polling が安定する。

```typescript
// 既存サーバーエンドポイントをそのまま利用
const SERVER_API = process.env.EXPO_PUBLIC_SERVER_API_URL;

// GET /api/v1/games - ゲーム一覧
// GET /api/v1/games/:gameId - ゲーム詳細 (polling)
// GET /api/v1/admin/health - ヘルスチェック
```

Polling 間隔:
- ゲーム一覧: 5秒
- ゲーム観戦中: 2秒
- バックグラウンド: 停止

---

## Implementation Checklist

### Phase 1: Bootstrap (1-2日)
- [ ] `mobile/` ディレクトリに Expo プロジェクト作成
- [ ] Dependencies インストール
- [ ] Polyfills 設定 (`polyfills.ts`, `metro.config.js`)
- [ ] `app.json` 設定 (Android, scheme, plugins)
- [ ] `.env` 環境変数設定
- [ ] TypeScript 設定 (`tsconfig.json`)
- [ ] `expo run:android` で起動確認

### Phase 2: Wallet (1-2日)
- [ ] `WalletProvider.tsx` (MWA context)
- [ ] `useWallet.ts` hook
- [ ] `WalletButton.tsx` component
- [ ] Auth token persistence (SecureStore)
- [ ] `anchor.ts` (read-only program + tx builder)
- [ ] MWA 接続テスト (Phantom Android)

### Phase 3: State & Data (1-2日)
- [ ] `lib/` ファイル移植 (constants, solana, types, format, IDL)
- [ ] `gamesStore.ts` 移植
- [ ] `watchGameStore.ts` 移植 (onAccountChange → polling)
- [ ] `myBetsStore.ts` 移植
- [ ] `useAppStateReconnect` hook
- [ ] Server API polling 動作確認

### Phase 4: UI (3-5日)
- [ ] `theme.ts` (colors, spacing, typography)
- [ ] `GlassCard.tsx`, `NeonText.tsx` (design system)
- [ ] Navigation structure (`_layout.tsx`)
- [ ] Home screen (`index.tsx`) - stats + game list
- [ ] `GameCard.tsx`, `GameList.tsx` (FlatList)
- [ ] `GameStatusBadge.tsx`, `AgentInfo.tsx`
- [ ] `PlayingCard.tsx` (single card rendering)
- [ ] `HoleCards.tsx`, `CommunityCards.tsx`
- [ ] `PokerTable.tsx` (main game view)
- [ ] `ChipStack.tsx`, `PotDisplay.tsx`, `PhaseIndicator.tsx`, `ActionBadge.tsx`
- [ ] `BettingPanel.tsx` (TextInput, Slider, presets)
- [ ] `OddsDisplay.tsx`, `ClaimButton.tsx`
- [ ] Game detail screen (`games/[gameId].tsx`)
- [ ] My Bets screen (`my-bets.tsx`)
- [ ] Leaderboard screen (`leaderboard.tsx`)

### Phase 5: Polish (1-2日)
- [ ] Card animations (Reanimated)
- [ ] Loading skeletons
- [ ] Error handling / offline states
- [ ] Winner overlay animation
- [ ] Pull-to-refresh on game list
- [ ] Haptic feedback on bet placement

---

## File Reuse Map

直接コピーして使えるファイル（変更量: 小）:

| Source (Web) | Destination (Mobile) | Changes |
|-------------|---------------------|---------|
| `app/lib/types.ts` | `mobile/lib/types.ts` | なし |
| `app/lib/format.ts` | `mobile/lib/format.ts` | なし |
| `app/lib/solana.ts` | `mobile/lib/solana.ts` | なし |
| `app/lib/claw_poker_idl.json` | `mobile/lib/claw_poker_idl.json` | なし |
| `app/stores/myBetsStore.ts` | `mobile/stores/myBetsStore.ts` | import path のみ |
| `app/stores/gamesStore.ts` | `mobile/stores/gamesStore.ts` | env var prefix, import path |

大幅な書き換えが必要なファイル:

| Source (Web) | Destination (Mobile) | Reason |
|-------------|---------------------|--------|
| `app/providers/WalletProvider.tsx` | `mobile/providers/WalletProvider.tsx` | wallet-adapter → MWA |
| `app/lib/anchor.ts` | `mobile/lib/anchor.ts` | hook → function, signing flow |
| `app/lib/constants.ts` | `mobile/lib/constants.ts` | env var prefix |
| `app/stores/watchGameStore.ts` | `mobile/stores/watchGameStore.ts` | onAccountChange → polling |
| All UI components | New implementations | HTML/CSS → RN View/Text/StyleSheet |

---

## Technical Constraints

1. **Anchor 0.28.0 固定** - 0.29+ は RN polyfill 非互換
2. **Expo Go 使用不可** - MWA ネイティブモジュールが必要なため `expo-dev-client` 必須
3. **Android 専用** - MWA は Android Intent ベース。iOS は対象外
4. **Private ER (TEE)** - エージェント専用。モバイルアプリは L1 + Public ER のみ使用
5. **WebSocket 制限** - バックグラウンドで切断される。polling ベースに統一推奨
6. **Polyfill 順序** - `react-native-quick-crypto/shim` は**全ての import より前**に読み込む必要あり

---

## Testing

```bash
# Android emulator で起動
npx expo run:android

# 物理デバイス (Phantom インストール済み)
npx expo run:android --device

# EAS Build (クラウドビルド)
eas build --profile development --platform android
```

MWA テストには **Phantom がインストールされた Android デバイス/エミュレータ** が必要。

---

## References

- [Solana Mobile Docs - Expo Setup](https://docs.solanamobile.com/react-native/expo)
- [MWA Protocol](https://docs.solanamobile.com/react-native/using_mobile_wallet_adapter)
- [Expo Router Docs](https://docs.expo.dev/router/introduction/)
- [react-native-quick-crypto](https://github.com/nicklockwood/react-native-quick-crypto)
- [NativeWind](https://www.nativewind.dev/)
- [Expo BlurView](https://docs.expo.dev/versions/latest/sdk/blur-view/)
- [React Native Reanimated](https://docs.swmansion.com/react-native-reanimated/)
