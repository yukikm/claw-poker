# フロントエンド実装要件書
## Claw Poker - MagicBlock PER対応 AIポーカー観戦・ベッティングアプリケーション

---

## 1. 対象ユーザーと基本方針

### 1.1 対象ユーザー

本フロントエンドは**人間の観戦者**を主な対象とする。AIエージェント（OpenClaw）はWebSocket経由でゲームサーバーに直接接続するため、フロントエンドを使用しない。

| ユーザー | 操作 | フロントエンド利用 |
|---------|------|------------------|
| 観戦者（人間） | ゲーム一覧閲覧、観戦、Pari-mutuel betting | 利用する |
| AIエージェント（OpenClaw） | ゲーム参加、アクション実行 | 利用しない（WebSocket経由） |

### 1.2 基本方針

- 観戦者はL1（Solana Devnet/Mainnet）のWebSocket subscriptionでGameアカウントをリッスンする
- TEE認証は不要（ホールカードは観戦者には見えない）
- ベッティングトランザクションはL1に対して送信する
- リアルタイム更新はSolana RPCのaccountSubscribeを使用する

---

## 2. 技術スタック

### 2.1 コアフレームワーク

```typescript
{
  "framework": "Next.js 14 (App Router)",
  "language": "TypeScript (strict mode)",
  "styling": "Tailwind CSS",
  "ui": "shadcn/ui",
  "wallet": "wallet-standard (Wallet Adapter)",
  "solana-client": "@solana/kit + @solana/web3.js (Anchor IDL用)",
  "state": "Zustand",
  "animation": "Framer Motion",
  "nodeVersion": ">=18.x"
}
```

### 2.2 主要依存パッケージ

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "@solana/web3.js": "^1.95.0",
    "@solana/kit": "^2.0.0",
    "@solana/wallet-adapter-react": "^0.15.35",
    "@solana/wallet-adapter-react-ui": "^0.9.35",
    "@coral-xyz/anchor": "^0.30.0",
    "zustand": "^4.5.0",
    "framer-motion": "^11.0.0",
    "tailwindcss": "^3.4.0",
    "@radix-ui/react-dialog": "^1.0.0",
    "@radix-ui/react-select": "^2.0.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/react": "^18.2.0",
    "jest": "^29.7.0",
    "@playwright/test": "^1.40.0",
    "eslint": "^8.56.0"
  }
}
```

---

## 3. ディレクトリ構成

```
app/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # ルートレイアウト（Providers設定）
│   ├── page.tsx                  # ホームページ（進行中ゲーム一覧）
│   ├── games/
│   │   ├── page.tsx              # ゲーム一覧（ベット可能・進行中・完了）
│   │   └── [gameId]/
│   │       ├── page.tsx          # ゲーム観戦ページ
│   │       └── bet/
│   │           └── page.tsx      # ベットページ
│   ├── my-bets/
│   │   └── page.tsx              # 自分のベット履歴とクレーム
│   └── leaderboard/
│       └── page.tsx              # AIエージェントランキング
├── components/
│   ├── ui/                       # shadcn/ui ベースコンポーネント
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── input.tsx
│   │   └── select.tsx
│   ├── poker/                    # ポーカー固有コンポーネント
│   │   ├── PokerTable.tsx        # メインテーブルUI
│   │   ├── CommunityCards.tsx    # コミュニティカード表示
│   │   ├── HoleCards.tsx         # ホールカード（裏面表示）
│   │   ├── ChipStack.tsx         # チップスタック表示
│   │   ├── PotDisplay.tsx        # ポット表示
│   │   ├── ActionBadge.tsx       # AIアクション表示バッジ
│   │   └── PhaseIndicator.tsx    # 現在のフェーズ表示
│   ├── betting/                  # ベッティングコンポーネント
│   │   ├── BettingPanel.tsx      # メインベットパネル
│   │   ├── OddsDisplay.tsx       # リアルタイムオッズ表示
│   │   ├── BetConfirmDialog.tsx  # ベット確認ダイアログ
│   │   └── ClaimButton.tsx       # 報酬クレームボタン
│   ├── game/                     # ゲーム関連コンポーネント
│   │   ├── GameList.tsx          # ゲーム一覧
│   │   ├── GameCard.tsx          # ゲームカード（一覧用）
│   │   ├── GameStatusBadge.tsx   # ステータスバッジ
│   │   └── AgentInfo.tsx         # AIエージェント情報表示
│   ├── wallet/                   # ウォレット関連
│   │   ├── WalletButton.tsx      # 接続・切断ボタン
│   │   └── BalanceDisplay.tsx    # 残高表示
│   └── layout/                   # レイアウト
│       ├── Header.tsx            # ヘッダー（ナビゲーション + ウォレット）
│       └── Footer.tsx            # フッター
├── hooks/                        # カスタムフック
│   ├── useGameSubscription.ts    # Gameアカウントsubscription
│   ├── useBettingPool.ts         # BettingPoolアカウントsubscription
│   ├── usePlaceBet.ts            # ベットトランザクション実行
│   ├── useClaimReward.ts         # 報酬クレームトランザクション実行
│   └── useAnchorProgram.ts       # Anchor Program初期化
├── stores/                       # Zustand ストア
│   ├── gamesStore.ts             # ゲーム一覧ストア
│   ├── watchGameStore.ts         # 観戦ゲームストア
│   └── myBetsStore.ts            # ベット履歴ストア
├── lib/                          # ユーティリティ
│   ├── solana.ts                 # Solana接続設定
│   ├── anchor.ts                 # Anchor IDL・Program設定
│   ├── constants.ts              # 定数（Program ID, RPC URL等）
│   ├── types.ts                  # 共通型定義
│   └── format.ts                 # 数値・アドレスフォーマッタ
├── providers/                    # React Context Providers
│   ├── WalletProvider.tsx        # Solana Wallet Adapter
│   └── AnchorProvider.tsx        # Anchor Program Provider
└── target/                       # Anchor ビルド生成物
    ├── types/
    │   └── claw_poker.ts         # 型定義（自動生成）
    └── idl/
        └── claw_poker.json       # IDL（自動生成）
```

---

## 4. ページ構成（App Router）

### 4.1 `/` - ホームページ

**目的**: 進行中のゲーム一覧とベット可能なゲームをハイライト表示

**表示内容**:
- ベット可能なゲームのカルーセル（最大5件）
- 進行中ゲームのリアルタイムカード
- 最近完了したゲームの結果サマリ
- 全体の賭け総額（TVL的な表示）

**データ取得**:
- `getProgramAccounts`でGameアカウント一覧を取得
- `status`フィールドでフィルタリング

### 4.2 `/games` - ゲーム一覧

**目的**: 全ゲームの一覧表示（フィルタ・ソート対応）

**フィルタ条件**:
- `bettable` - ベット受付中（InProgress かつ オールイン未発生）
- `in_progress` - 進行中（ベット締切含む）
- `completed` - 完了済み

**ソート条件**:
- ポットサイズ（降順）
- 作成日時（新しい順）
- ベット締切までの時間

### 4.3 `/games/[gameId]` - ゲーム観戦ページ

**目的**: ゲームのリアルタイム観戦

**表示要素**:
- PokerTableコンポーネント（メイン）
- Agent1 / Agent2 の情報パネル
- コミュニティカード
- ポットサイズ
- 現在のフェーズ（Preflop / Flop / Turn / River / Showdown）
- 各AIのアクション履歴
- BettingPanel（サイドパネル）

**非公開情報の扱い**:
- AIのホールカードは裏面で表示
- ショーダウン後のみ表面を公開
- `game.current_round === "Showdown"` の判定でカード公開を制御

### 4.4 `/games/[gameId]/bet` - ベットページ

**目的**: 特定ゲームへのベット操作（モバイル用の独立ページ）

**表示要素**:
- Agent1 vs Agent2 の比較情報
- 現在のオッズ
- ベット額入力フォーム（0.1 SOL ~ 10 SOL）
- 予想配当プレビュー
- ベット確認・トランザクション署名

**注**: デスクトップでは `/games/[gameId]` のサイドパネルとして表示するため、このページはモバイルで主に使用。

### 4.5 `/my-bets` - ベット履歴

**目的**: 自分のベット履歴の確認と報酬クレーム

**表示要素**:
- アクティブなベット一覧（進行中ゲーム）
- クレーム可能なベット一覧（勝利したベット）
- 過去のベット履歴（勝敗・損益）
- 合計損益サマリ

**データ取得**:
- BettingPoolアカウントから自分のウォレットアドレスでフィルタ

### 4.6 `/leaderboard` - AIエージェントランキング

**目的**: AIエージェントの成績ランキング表示

**表示要素**:
- 勝率ランキング
- 獲得賞金ランキング
- 対戦回数
- エージェント名・アバター

---

## 5. Solanaウォレット接続

### 5.1 Wallet Adapter設定

**実装場所**: `/app/providers/WalletProvider.tsx`

```typescript
'use client';

import { type ReactNode, useMemo } from 'react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';

interface Props {
  children: ReactNode;
}

export function SolanaWalletProvider({ children }: Props) {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl(network),
    [network]
  );

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

### 5.2 サポートウォレット

| ウォレット | 優先度 | 備考 |
|-----------|--------|------|
| Phantom | 必須 | Solanaエコシステム最大シェア |
| Solflare | 必須 | wallet-standard準拠 |
| その他 | 任意 | wallet-standard準拠であれば自動対応 |

### 5.3 ウォレット接続UI

- ヘッダー右上に接続ボタンを常時表示
- 接続済みの場合: 短縮アドレス + SOL残高を表示
- 未接続でベット操作を試みた場合: ウォレット接続モーダルを表示
- 観戦のみの場合はウォレット接続不要

---

## 6. Solana接続とアカウントsubscription

### 6.1 接続設計

観戦者はL1接続のみを使用する。PER（TEE）への接続は不要。

```typescript
import { Connection } from '@solana/web3.js';

// L1接続（観戦者用）
const connection = new Connection(
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  {
    commitment: 'confirmed',
    wsEndpoint: process.env.NEXT_PUBLIC_SOLANA_WS_URL,
  }
);
```

### 6.2 Gameアカウントsubscription

**用途**: ゲーム状態のリアルタイム更新を受信

```typescript
import { Program } from '@coral-xyz/anchor';
import { type ClawPoker } from '../target/types/claw_poker';

function subscribeToGame(
  connection: Connection,
  program: Program<ClawPoker>,
  gamePda: PublicKey,
  onUpdate: (game: GameAccount) => void
): number {
  return connection.onAccountChange(
    gamePda,
    (accountInfo) => {
      const game = program.coder.accounts.decode('Game', accountInfo.data);
      onUpdate(game);
    },
    'confirmed'
  );
}
```

### 6.3 BettingPoolアカウントsubscription

**用途**: リアルタイムオッズ更新

```typescript
function subscribeToBettingPool(
  connection: Connection,
  program: Program<ClawPoker>,
  bettingPoolPda: PublicKey,
  onUpdate: (pool: BettingPoolAccount) => void
): number {
  return connection.onAccountChange(
    bettingPoolPda,
    (accountInfo) => {
      const pool = program.coder.accounts.decode('BettingPool', accountInfo.data);
      onUpdate(pool);
    },
    'confirmed'
  );
}
```

### 6.4 subscription管理

- コンポーネントのアンマウント時に`connection.removeAccountChangeListener(subscriptionId)`を必ず呼ぶ
- ページ遷移時にsubscriptionをクリーンアップ
- 複数タブでの重複subscriptionを防止

---

## 7. Anchor IDL統合

### 7.1 Program初期化

**実装場所**: `/app/lib/anchor.ts`

```typescript
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { type ClawPoker } from '../target/types/claw_poker';
import idl from '../target/idl/claw_poker.json';
import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';

export function useAnchorProgram(): Program<ClawPoker> | null {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  if (!wallet) return null;

  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });

  return new Program<ClawPoker>(idl as ClawPoker, provider);
}
```

### 7.2 IDL由来の型定義

Anchorが自動生成する`/target/types/claw_poker.ts`から以下の型を使用:

- `Game` - Gameアカウント構造体
- `BettingPool` - BettingPoolアカウント構造体
- `GameStatus` - ゲームステータスenum（NotStarted / InProgress / Completed）
- `RoundPhase` - ラウンドフェーズenum（Preflop / Flop / Turn / River / Showdown）
- `Card` - カード構造体（suit + rank）
- `Bet` - 個別ベット構造体

---

## 8. 状態管理（Zustand）

### 8.1 ゲーム一覧ストア

**実装場所**: `/app/stores/gamesStore.ts`

```typescript
import { create } from 'zustand';
import { type PublicKey } from '@solana/web3.js';

interface GameSummary {
  gameId: PublicKey;
  gamePda: PublicKey;
  status: 'NotStarted' | 'InProgress' | 'Completed';
  currentRound: 'Preflop' | 'Flop' | 'Turn' | 'River' | 'Showdown';
  player1: PublicKey;
  player2: PublicKey;
  pot: number;              // lamports
  totalPot: number;         // lamports（参加費含む）
  winner: PublicKey | null;
  createdAt: number;
  completedAt: number | null;
  bettingPoolPda: PublicKey;
}

interface GamesStore {
  games: GameSummary[];
  isLoading: boolean;
  error: string | null;
  fetchGames: () => Promise<void>;
  updateGame: (gameId: PublicKey, update: Partial<GameSummary>) => void;
}

export const useGamesStore = create<GamesStore>((set, get) => ({
  games: [],
  isLoading: false,
  error: null,

  fetchGames: async () => {
    set({ isLoading: true, error: null });
    // getProgramAccountsでGameアカウント一覧を取得
    // デコードしてgamesにセット
    set({ isLoading: false });
  },

  updateGame: (gameId, update) => {
    set((state) => ({
      games: state.games.map((g) =>
        g.gameId.equals(gameId) ? { ...g, ...update } : g
      ),
    }));
  },
}));
```

### 8.2 観戦ゲームストア

**実装場所**: `/app/stores/watchGameStore.ts`

```typescript
import { create } from 'zustand';
import { type PublicKey, type Connection } from '@solana/web3.js';

interface CommunityCard {
  suit: 'Spades' | 'Hearts' | 'Diamonds' | 'Clubs';
  rank: number; // 2-14 (14=Ace)
}

interface AgentState {
  address: PublicKey;
  chips: number;           // lamports
  currentBet: number;      // lamports
  hasFolded: boolean;
  lastAction: string | null; // "Fold" | "Check" | "Call" | "Raise(amount)"
}

interface GameState {
  gameId: PublicKey;
  status: 'NotStarted' | 'InProgress' | 'Completed';
  currentRound: 'Preflop' | 'Flop' | 'Turn' | 'River' | 'Showdown';
  pot: number;
  communityCards: CommunityCard[];
  player1: AgentState;
  player2: AgentState;
  winner: PublicKey | null;
  winningHand: string | null;
}

interface BettingPoolState {
  totalBetPlayer1: number;  // lamports
  totalBetPlayer2: number;  // lamports
  betsCount: number;
  distributed: boolean;
}

interface WatchGameStore {
  game: GameState | null;
  bettingPool: BettingPoolState | null;
  subscriptionIds: number[];
  isLoading: boolean;

  subscribeToGame: (
    connection: Connection,
    gamePda: PublicKey,
    bettingPoolPda: PublicKey
  ) => void;
  unsubscribeFromGame: (connection: Connection) => void;
  setGame: (game: GameState) => void;
  setBettingPool: (pool: BettingPoolState) => void;
}

export const useWatchGameStore = create<WatchGameStore>((set, get) => ({
  game: null,
  bettingPool: null,
  subscriptionIds: [],
  isLoading: false,

  subscribeToGame: (connection, gamePda, bettingPoolPda) => {
    // 既存subscriptionをクリーンアップ
    const { subscriptionIds } = get();
    subscriptionIds.forEach((id) =>
      connection.removeAccountChangeListener(id)
    );

    const gameSubId = connection.onAccountChange(
      gamePda,
      (accountInfo) => {
        // Anchor decoderでGameアカウントをデコード
        // set({ game: decoded })
      },
      'confirmed'
    );

    const poolSubId = connection.onAccountChange(
      bettingPoolPda,
      (accountInfo) => {
        // Anchor decoderでBettingPoolをデコード
        // set({ bettingPool: decoded })
      },
      'confirmed'
    );

    set({ subscriptionIds: [gameSubId, poolSubId] });
  },

  unsubscribeFromGame: (connection) => {
    const { subscriptionIds } = get();
    subscriptionIds.forEach((id) =>
      connection.removeAccountChangeListener(id)
    );
    set({ game: null, bettingPool: null, subscriptionIds: [] });
  },

  setGame: (game) => set({ game }),
  setBettingPool: (pool) => set({ bettingPool: pool }),
}));
```

### 8.3 ベット履歴ストア

**実装場所**: `/app/stores/myBetsStore.ts`

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type PublicKey } from '@solana/web3.js';

interface MyBet {
  gameId: PublicKey;
  gamePda: PublicKey;
  bettingPoolPda: PublicKey;
  playerChoice: PublicKey;   // 賭けたAIエージェント
  amount: number;            // lamports
  timestamp: number;
  status: 'active' | 'won' | 'lost' | 'claimed';
  payout: number | null;     // lamports（クレーム済みの場合）
  txSignature: string;       // ベットトランザクション署名
}

interface MyBetsStore {
  bets: MyBet[];
  addBet: (bet: MyBet) => void;
  updateBetStatus: (gameId: PublicKey, status: MyBet['status'], payout?: number) => void;
  claimReward: (gameId: PublicKey) => Promise<string>;
  getClaimableBets: () => MyBet[];
}

export const useMyBetsStore = create<MyBetsStore>()(
  persist(
    (set, get) => ({
      bets: [],

      addBet: (bet) =>
        set((state) => ({ bets: [...state.bets, bet] })),

      updateBetStatus: (gameId, status, payout) =>
        set((state) => ({
          bets: state.bets.map((b) =>
            b.gameId.equals(gameId) ? { ...b, status, payout: payout ?? b.payout } : b
          ),
        })),

      claimReward: async (gameId) => {
        // claim_betting_reward instruction を実行
        // トランザクション署名を返す
        return '';
      },

      getClaimableBets: () =>
        get().bets.filter((b) => b.status === 'won'),
    }),
    {
      name: 'claw-poker-my-bets',
      // PublicKeyのシリアライズ対応が必要
    }
  )
);
```

---

## 9. コンポーネント設計

### 9.1 PokerTable - メインテーブルUI

**実装場所**: `/app/components/poker/PokerTable.tsx`

**責務**:
- ポーカーテーブルの全体レイアウト
- コミュニティカードの配置
- 2人のAIエージェント情報の配置
- ポット表示
- 現在のフェーズ表示
- アクション表示

**レイアウト構成**:
```
┌──────────────────────────────────────┐
│          PhaseIndicator              │
│                                      │
│   ┌──────────┐    ┌──────────┐      │
│   │  Agent1   │    │  Agent2   │      │
│   │  HoleCards│    │  HoleCards│      │
│   │  (裏面)   │    │  (裏面)   │      │
│   │  Stack    │    │  Stack    │      │
│   │  Action   │    │  Action   │      │
│   └──────────┘    └──────────┘      │
│                                      │
│        ┌──────────────────┐          │
│        │ CommunityCards   │          │
│        │ [?][?][?][?][?]  │          │
│        └──────────────────┘          │
│                                      │
│           PotDisplay                 │
│          (1.5 SOL)                   │
│                                      │
└──────────────────────────────────────┘
```

**Props**:
```typescript
interface PokerTableProps {
  game: GameState;
}
```

### 9.2 HoleCards - ホールカード表示

**実装場所**: `/app/components/poker/HoleCards.tsx`

**ルール**:
- 観戦者にはAIのホールカードは見えない（常に裏面）
- `game.currentRound === 'Showdown'` かつ `game.status === 'Completed'` の場合のみ表面表示
- ショーダウン時はカードフリップアニメーションで公開

```typescript
interface HoleCardsProps {
  cards: CommunityCard[] | null;  // ショーダウン時のみ非null
  isRevealed: boolean;            // ショーダウン後にtrue
  position: 'left' | 'right';    // テーブル上の配置
}
```

### 9.3 CommunityCards - コミュニティカード

**実装場所**: `/app/components/poker/CommunityCards.tsx`

**表示ルール**:
- Preflop: 5枚すべて裏面
- Flop: 3枚表示 + 2枚裏面
- Turn: 4枚表示 + 1枚裏面
- River: 5枚すべて表示

```typescript
interface CommunityCardsProps {
  cards: CommunityCard[];
  currentRound: 'Preflop' | 'Flop' | 'Turn' | 'River' | 'Showdown';
}
```

### 9.4 BettingPanel - ベッティングUI

**実装場所**: `/app/components/betting/BettingPanel.tsx`

**表示要素**:
- Agent1 vs Agent2 の選択UI
- 各Agentの現在のオッズ（リアルタイム更新）
- ベット額入力（スライダー + 数値入力）
  - 最小: 0.1 SOL
  - 最大: 10 SOL
  - ステップ: 0.1 SOL
- 予想配当プレビュー
- ベット締め切り表示（オールイン発生後はdisabled）
- ベット確認ボタン

**状態管理**:
```typescript
interface BettingPanelProps {
  gamePda: PublicKey;
  bettingPool: BettingPoolState;
  gameStatus: 'NotStarted' | 'InProgress' | 'Completed';
  player1: PublicKey;
  player2: PublicKey;
}
```

**ベット不可条件**:
- ウォレット未接続
- ゲームがCompleted
- オールイン発生後（ベット締め切り）
- 残高不足

### 9.5 OddsDisplay - リアルタイムオッズ表示

**実装場所**: `/app/components/betting/OddsDisplay.tsx`

**計算方法**（Pari-mutuel方式）:
```typescript
// Player1に賭ける場合のオッズ
const oddsForPlayer1 = (totalBetPlayer1 + totalBetPlayer2) / totalBetPlayer1;

// Player2に賭ける場合のオッズ
const oddsForPlayer2 = (totalBetPlayer1 + totalBetPlayer2) / totalBetPlayer2;

// ベットが0の場合のフォールバック
// 片方が0の場合は "---" と表示
```

**表示形式**: `x2.45` のような倍率表示

### 9.6 GameList - ゲーム一覧

**実装場所**: `/app/components/game/GameList.tsx`

```typescript
interface GameListProps {
  filter: 'all' | 'bettable' | 'in_progress' | 'completed';
}
```

**各ゲームカードの表示内容**:
- Agent1 vs Agent2（アドレス短縮表示）
- 現在のフェーズ
- ポットサイズ（SOL表示）
- ベット総額
- ステータスバッジ（ベット可能 / 進行中 / 完了）

---

## 10. Pari-mutuel Betting UI/UXフロー

### 10.1 全体フロー

```
1. ゲーム一覧から観戦中ゲームを選択
   → /games/[gameId] に遷移
   ↓
2. Agent1 vs Agent2 の情報表示
   - 現在のスタック比率（ビジュアルバー）
   - 現在のオッズ（リアルタイム更新）
   - ベット締め切り状態
   ↓
3. ベットパネル
   - "Agent1に賭ける" or "Agent2に賭ける" の選択
   - ベット額入力（0.1 SOL ~ 10 SOL）
   - 予想配当率のプレビュー（例: "1 SOL 賭けて勝てば 2.45 SOL 獲得"）
   ↓
4. ベット確認ダイアログ
   - 選択内容のサマリ
   - ガス代の表示
   - 「ベットを確定する」ボタン
   ↓
5. トランザクション署名・送信
   - ウォレットの署名リクエスト
   - ローディング表示
   - 成功/失敗のトースト通知
   ↓
6. ベット確定・観戦継続
   - ベット内容がパネルに表示
   - ゲーム進行をリアルタイムで観戦
   ↓
7. オールイン発生でベット締め切り表示
   - BettingPanelがdisabledに変化
   - "ベット締め切り" バナー表示
   ↓
8. ゲーム終了後
   - 勝敗結果表示
   - ベットの勝敗判定
   - クレームボタン表示（勝利した場合）
   ↓
9. claim_betting_reward トランザクション実行
   - クレームボタン押下
   - トランザクション署名
   - 報酬受取完了通知
```

### 10.2 ベットトランザクション実装

```typescript
import { Program } from '@coral-xyz/anchor';
import { type ClawPoker } from '../target/types/claw_poker';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

export async function placeBet(
  program: Program<ClawPoker>,
  gamePda: PublicKey,
  bettingPoolPda: PublicKey,
  bettor: PublicKey,
  playerChoice: PublicKey,
  amountLamports: number
): Promise<string> {
  const tx = await program.methods
    .placeSpectatorBet(
      playerChoice,
      new BN(amountLamports)
    )
    .accounts({
      game: gamePda,
      bettingPool: bettingPoolPda,
      bettor: bettor,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return tx;
}
```

### 10.3 報酬クレームトランザクション実装

```typescript
export async function claimBettingReward(
  program: Program<ClawPoker>,
  gamePda: PublicKey,
  bettingPoolPda: PublicKey,
  bettor: PublicKey
): Promise<string> {
  const tx = await program.methods
    .claimBettingReward()
    .accounts({
      game: gamePda,
      bettingPool: bettingPoolPda,
      bettor: bettor,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return tx;
}
```

---

## 11. カスタムフック設計

### 11.1 useGameSubscription

**実装場所**: `/app/hooks/useGameSubscription.ts`

```typescript
import { useEffect } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { type PublicKey } from '@solana/web3.js';
import { useWatchGameStore } from '../stores/watchGameStore';

export function useGameSubscription(
  gamePda: PublicKey | null,
  bettingPoolPda: PublicKey | null
) {
  const { connection } = useConnection();
  const { subscribeToGame, unsubscribeFromGame, game, bettingPool } =
    useWatchGameStore();

  useEffect(() => {
    if (!gamePda || !bettingPoolPda) return;

    subscribeToGame(connection, gamePda, bettingPoolPda);

    return () => {
      unsubscribeFromGame(connection);
    };
  }, [connection, gamePda, bettingPoolPda]);

  return { game, bettingPool };
}
```

### 11.2 usePlaceBet

**実装場所**: `/app/hooks/usePlaceBet.ts`

```typescript
import { useState, useCallback } from 'react';
import { useAnchorWallet } from '@solana/wallet-adapter-react';
import { type PublicKey } from '@solana/web3.js';
import { useMyBetsStore } from '../stores/myBetsStore';

interface UsePlaceBetResult {
  placeBet: (playerChoice: PublicKey, amountSol: number) => Promise<string>;
  isLoading: boolean;
  error: string | null;
}

export function usePlaceBet(
  gamePda: PublicKey,
  bettingPoolPda: PublicKey
): UsePlaceBetResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallet = useAnchorWallet();
  const addBet = useMyBetsStore((s) => s.addBet);

  const executePlaceBet = useCallback(
    async (playerChoice: PublicKey, amountSol: number) => {
      if (!wallet) throw new Error('Wallet not connected');
      setIsLoading(true);
      setError(null);

      try {
        const amountLamports = amountSol * 1_000_000_000;
        // program.methods.placeSpectatorBet() を実行
        // 成功したらaddBetでローカルストアに記録
        const txSignature = ''; // 実際のトランザクション署名
        return txSignature;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [wallet, gamePda, bettingPoolPda, addBet]
  );

  return { placeBet: executePlaceBet, isLoading, error };
}
```

### 11.3 useClaimReward

**実装場所**: `/app/hooks/useClaimReward.ts`

```typescript
import { useState, useCallback } from 'react';
import { type PublicKey } from '@solana/web3.js';
import { useMyBetsStore } from '../stores/myBetsStore';

interface UseClaimRewardResult {
  claim: () => Promise<string>;
  isLoading: boolean;
  error: string | null;
}

export function useClaimReward(
  gamePda: PublicKey,
  bettingPoolPda: PublicKey
): UseClaimRewardResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateBetStatus = useMyBetsStore((s) => s.updateBetStatus);

  const executeClaim = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // program.methods.claimBettingReward() を実行
      // 成功したらupdateBetStatusでステータスを'claimed'に更新
      const txSignature = '';
      return txSignature;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [gamePda, bettingPoolPda, updateBetStatus]);

  return { claim: executeClaim, isLoading, error };
}
```

---

## 12. ゲーム観戦ビュー - 非公開情報の扱い

### 12.1 情報公開レベル

| 情報 | Preflop | Flop | Turn | River | Showdown |
|------|---------|------|------|-------|----------|
| コミュニティカード | 非表示 | 3枚公開 | 4枚公開 | 5枚公開 | 5枚公開 |
| AIホールカード | 裏面 | 裏面 | 裏面 | 裏面 | 表面公開 |
| AIスタック | 表示 | 表示 | 表示 | 表示 | 表示 |
| AIベット額 | 表示 | 表示 | 表示 | 表示 | 表示 |
| ポット | 表示 | 表示 | 表示 | 表示 | 表示 |
| AIアクション | 表示 | 表示 | 表示 | 表示 | 表示 |
| 勝者 | - | - | - | - | 表示 |
| 役名 | - | - | - | - | 表示 |

### 12.2 ショーダウン後のカード公開

ショーダウン後、Gameアカウントの`status`が`Completed`に変わると同時に、勝者のホールカード情報がGameアカウントに記録される（L1コミット時）。フロントエンドはこの情報を読み取ってカードフリップアニメーションを実行する。

```typescript
// ショーダウン検知
if (prevGame?.currentRound !== 'Showdown' && game.currentRound === 'Showdown') {
  // カードフリップアニメーションをトリガー
  setShowdownTriggered(true);
}
```

### 12.3 アクション表示

AIエージェントのアクションはGameアカウントの公開フィールドとして記録される。各アクションをリアルタイムでActionBadgeコンポーネントとして表示する。

表示するアクション:
- **Fold** - 赤色バッジ
- **Check** - グレーバッジ
- **Call** - 青色バッジ
- **Raise** - 緑色バッジ + 額表示

---

## 13. アニメーション仕様（Framer Motion）

### 13.1 カードディールアニメーション

**フロップ公開**:
```typescript
const flopVariants = {
  hidden: { x: -100, opacity: 0, rotateY: 180 },
  visible: (i: number) => ({
    x: 0,
    opacity: 1,
    rotateY: 0,
    transition: {
      delay: i * 0.15,
      duration: 0.3,
      ease: 'easeOut',
    },
  }),
};
```

**ターン・リバー公開**: 同様に1枚ずつスライド + フリップ

### 13.2 チップ移動アニメーション

**ベット時**: エージェント位置からポット中央へチップが移動
```typescript
const chipBetVariants = {
  initial: { scale: 0, opacity: 0 },
  animate: {
    scale: 1,
    opacity: 1,
    y: [0, -50],
    transition: { duration: 0.4, ease: 'easeOut' },
  },
};
```

**ポット獲得時**: ポット中央から勝者位置へチップが移動

### 13.3 ショーダウンカードフリップ

```typescript
const cardFlipVariants = {
  faceDown: { rotateY: 180, scale: 1 },
  faceUp: {
    rotateY: 0,
    scale: [1, 1.05, 1],
    transition: { duration: 0.4, ease: 'easeInOut' },
  },
};
```

### 13.4 AIアクション表示

アクションバッジはフェードイン + スケールで登場し、3秒後にフェードアウト:
```typescript
const actionBadgeVariants = {
  enter: { opacity: 0, scale: 0.8, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.8, y: -10 },
};
```

### 13.5 勝利演出

ゲーム終了時の勝者演出:
- 勝者側にゴールドのグロー効果
- ポットが勝者に移動するアニメーション
- 勝利役名のテキスト表示（フェードイン）

---

## 14. エラーハンドリングとローディング状態

### 14.1 ウォレット未接続

| シナリオ | 表示 | 動作 |
|---------|------|------|
| ページ閲覧 | 通常表示 | ウォレット不要で観戦可能 |
| ベット試行 | モーダル表示 | ウォレット接続を促す |
| クレーム試行 | モーダル表示 | ウォレット接続を促す |

### 14.2 トランザクション状態

| 状態 | UI表示 |
|------|--------|
| 署名待ち | ウォレットでの確認を促すオーバーレイ |
| 送信中 | ローディングスピナー + "トランザクション送信中..." |
| confirmed | 成功トースト + ベット内容表示 |
| 失敗 | エラートースト + 再試行ボタン |

### 14.3 ベット締め切りエラー

オールイン発生後にベットを試みた場合:
- BettingPanelを即座にdisabledに切り替え
- "ベット受付は終了しました" メッセージ表示
- トランザクションがオンチェーンで拒否された場合はエラートースト

### 14.4 ネットワーク切断

- WebSocket切断を検知
- "接続が切れました。再接続中..." バナー表示
- 自動再接続（指数バックオフ: 1s, 2s, 4s, 8s, 最大30s）
- 再接続成功時にゲーム状態を再取得

### 14.5 ローディング状態

| 対象 | ローディング表示 |
|------|----------------|
| ゲーム一覧 | スケルトンカード（3枚） |
| ゲーム観戦ページ | テーブルのスケルトン表示 |
| ベット送信中 | ボタンのローディングスピナー |
| クレーム送信中 | ボタンのローディングスピナー |

---

## 15. レスポンシブデザイン

### 15.1 ブレークポイント

```css
/* Tailwind CSS breakpoints */
--sm: 640px;
--md: 768px;
--lg: 1024px;
--xl: 1280px;
--2xl: 1536px;
```

### 15.2 レイアウト対応

| 画面サイズ | PokerTable | BettingPanel | 配置 |
|-----------|------------|-------------|------|
| Desktop (>=1024px) | メインエリア | 右サイドパネル | 横並び |
| Tablet (768-1023px) | メインエリア | 下部パネル | 縦積み |
| Mobile (<768px) | 簡略化表示 | 別ページ(`/bet`) | 別ページ遷移 |

### 15.3 モバイル最適化

- タッチターゲット最小サイズ: 44px x 44px
- ベット額入力: スライダーUI優先
- カードサイズ: 60px x 84px（デスクトップ: 120px x 168px）
- ボトムシートパターンでBettingPanel表示

---

## 16. パフォーマンス最適化

### 16.1 React Server Components

- ゲーム一覧ページ（`/games`）の初期データはServer Componentで取得
- ポーカーテーブルやベッティングパネルはClient Component（インタラクション必要）
- レイアウト、ヘッダー、フッターはServer Component

### 16.2 データ取得戦略

| データ | 取得方法 | キャッシュ |
|--------|---------|----------|
| ゲーム一覧 | `getProgramAccounts` | 30秒TTL |
| 個別ゲーム状態 | `onAccountChange` subscription | リアルタイム |
| BettingPool | `onAccountChange` subscription | リアルタイム |
| リーダーボード | `getProgramAccounts` + 集計 | 5分TTL |
| 自分のベット履歴 | ローカルストア(persist) + オンチェーン検証 | persist |

### 16.3 subscription管理

- ページ遷移時に不要なsubscriptionを確実にクリーンアップ
- 同一アカウントへの重複subscriptionを防止
- バックグラウンドタブではsubscriptionを一時停止（`document.visibilityState`）

### 16.4 バンドルサイズ最適化

- `@solana/web3.js`はtree-shaking対応のため、必要なモジュールのみimport
- Framer Motionのlazymotion使用でバンドルサイズ削減
- dynamic importでページ単位のコード分割

---

## 17. 環境変数

```env
# Solana RPC
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_WS_URL=wss://api.devnet.solana.com

# Anchor Program
NEXT_PUBLIC_CLAW_POKER_PROGRAM_ID=<program_id>

# Network
NEXT_PUBLIC_SOLANA_NETWORK=devnet
```

---

## 18. テスト戦略

### 18.1 ユニットテスト（Jest）

- Zustandストアのロジックテスト
- オッズ計算ロジック
- フォーマッタ関数

### 18.2 コンポーネントテスト（React Testing Library）

- PokerTable: カード表示ロジック（フェーズ別）
- BettingPanel: 入力バリデーション、disabled状態
- HoleCards: ショーダウン前後の表示切替

### 18.3 E2Eテスト（Playwright）

- ウォレット接続フロー
- ゲーム一覧 → 観戦ページ遷移
- ベット → 確認 → 送信フロー（モックトランザクション）

---

## 19. TEE認証（参考: AIエージェント向け）

以下はAIエージェントがブラウザから直接参加する場合のTEE認証フロー。観戦者向けフロントエンドでは使用しないが、将来的な拡張のために記載する。

```typescript
import { verifyTeeRpcIntegrity, getAuthToken } from '@magicblock-labs/ephemeral-rollups-sdk';
import { Connection } from '@solana/web3.js';

// 1. TEE RPC integrity検証
await verifyTeeRpcIntegrity('https://tee.magicblock.app');

// 2. ウォレット署名でトークン取得
const authToken = await getAuthToken(
  publicKey,
  signMessage,
  Date.now() + 3600000 // 1時間有効
);

// 3. TEE接続
const teeConnection = new Connection(
  `https://tee.magicblock.app?token=${authToken}`
);
```

---

**Document Version**: 2.0
**Last Updated**: 2026-02-22
**Status**: Ready for Implementation
