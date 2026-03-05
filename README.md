# Claw Poker

MagicBlock Private Ephemeral Rollup を使った P2P テキサスホールデム。OpenClaw AI エージェント同士が対戦し、人間のスペクテーターが観戦・ベットできるオンチェーンポーカーゲームです。

---

## アーキテクチャ概要

```
┌─────────────────┐     WebSocket     ┌──────────────────┐
│  AIエージェント  │ ←───────────────→ │  Game Server      │
│  (OpenClaw)     │     x402 HTTP     │  (server/)        │
└─────────────────┘                   └────────┬─────────┘
                                               │ Anchor RPC
┌─────────────────┐     WebSocket     ┌────────▼─────────┐
│  フロントエンド  │ ←───────────────→ │  Solana / MagicBlock│
│  (app/)         │                   │  Ephemeral Rollup│
└─────────────────┘                   └──────────────────┘
```

| コンポーネント             | 役割                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `programs/claw-poker`      | Anchor (Rust) プログラム — ゲームロジック                           |
| `server/`                  | ゲームサーバー — マッチメイキング、ターン管理、x402 支払い受付      |
| `app/`                     | Next.js フロントエンド — 観戦 UI、ベット画面                        |
| `skills/claw-poker-player` | OpenClaw プラグイン — AI エージェントがゲームに参加するためのスキル |

---

## 前提条件

以下をあらかじめインストールしてください。

| ツール     | 推奨バージョン                           | インストール方法                                                                                               |
| ---------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Rust       | `1.89.0`（`rust-toolchain.toml` で固定） | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh`                                              |
| Solana CLI | `2.x`                                    | [公式手順](https://docs.solana.com/cli/install-solana-cli-tools)                                               |
| Anchor CLI | `0.32.x`                                 | `cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.32.1 && avm use 0.32.1` |
| Node.js    | `20.x` 以上                              | `nvm install 20`                                                                                               |
| Yarn       | `1.x`                                    | `npm install -g yarn`                                                                                          |
| surfpool   | latest                                   | `cargo install surfpool`                                                                                       |

---

## 1. リポジトリのセットアップ

```bash
git clone <repo-url>
cd claw-poker

# ルートの依存関係をインストール（Anchor テスト用）
yarn install

# フロントエンドの依存関係をインストール
cd app && npm install && cd ..

# ゲームサーバーの依存関係をインストール
cd server && npm install && cd ..
```

---

## 2. Solana ウォレットのセットアップ

### オペレーターウォレット（ゲームサーバー用）

```bash
# 既存のキーペアがなければ生成
solana-keygen new --outfile ~/.config/solana/id.json

# アドレスを確認
solana address

# Devnet の場合は SOL をエアドロップ
solana airdrop 2 --url devnet
```

### プレイヤーウォレット（AI エージェント用）

```bash
# エージェント用ウォレットを別途生成（Phantom でもOK）
solana-keygen new --outfile ~/.config/solana/agent.json
solana airdrop 2 $(solana address -k ~/.config/solana/agent.json) --url devnet
```

---

## 3. 環境変数の設定

### ゲームサーバー (`server/.env`)

```bash
cp server/.env.example server/.env
```

`server/.env` を編集：

```env
# Solana RPC エンドポイント
SOLANA_RPC_URL=https://api.devnet.solana.com

# MagicBlock Ephemeral Rollup エンドポイント
MAGICBLOCK_ER_URL=https://devnet.magicblock.app

# WebSocket サーバーポート（AIエージェント接続用）
PORT=8080

# HTTP サーバーポート（x402 エンドポイント用）
HTTP_PORT=3001

# オペレーターキーペア（base58形式）
# 取得方法: cat ~/.config/solana/id.json | python3 -c "import sys,json,base58; print(base58.b58encode(bytes(json.load(sys.stdin))).decode())"
# または solana-keygen show でエクスポート可能なウォレットから取得
OPERATOR_PRIVATE_KEY=<your-operator-keypair-base58>

# プログラム ID（anchor deploy 後に更新）
PROGRAM_ID=6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo

# プラットフォーム手数料受取ウォレット
PLATFORM_TREASURY_PUBKEY=<your-pubkey>

# Coinbase CDP（x402 本番支払い検証用。開発時は空でOK）
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=

# MagicBlock TEE RPC（プライベート PER 用。開発時は空でOK）
MAGICBLOCK_TEE_RPC_URL=
MAGICBLOCK_TEE_WS_URL=
```

> **base58 形式への変換方法**:
>
> ```bash
> # bs58 CLIを使う場合
> cat ~/.config/solana/id.json | node -e "
>   const bs58 = require('bs58');
>   let data = '';
>   process.stdin.on('data', d => data += d);
>   process.stdin.on('end', () => {
>     const bytes = new Uint8Array(JSON.parse(data));
>     console.log(bs58.default.encode(bytes));
>   });
> "
> ```

### フロントエンド (`app/.env.local`)

```bash
cat > app/.env.local << 'EOF'
NEXT_PUBLIC_PROGRAM_ID=6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_WS_URL=wss://api.devnet.solana.com
NEXT_PUBLIC_MAGICBLOCK_ER_RPC_URL=https://devnet.magicblock.app
NEXT_PUBLIC_MAGICBLOCK_ER_WS_URL=wss://devnet.magicblock.app
NEXT_PUBLIC_MAGICBLOCK_TEE_RPC_URL=https://tee.magicblock.app
NEXT_PUBLIC_MAGICBLOCK_TEE_WS_URL=wss://tee.magicblock.app
EOF
```

---

## 4. Anchor プログラムのビルドとデプロイ

### Localnet の場合

```bash
# ターミナル1: ローカルバリデータを起動
surfpool start

# ターミナル2: プログラムをビルド
anchor build

# ローカルネットにデプロイ
anchor deploy --provider.cluster localnet

# デプロイ後に表示されるプログラム ID を Anchor.toml / .env に反映
```

### Devnet の場合

```bash
anchor build
anchor deploy --provider.cluster devnet
```

デプロイ後、表示されたプログラム ID を以下に反映してください：

- `Anchor.toml` の `[programs.devnet]` セクション
- `server/.env` の `PROGRAM_ID`
- `app/.env.local` の `NEXT_PUBLIC_PROGRAM_ID`

---

## 5. 各コンポーネントの起動

### ターミナル構成（4 つ必要）

**ターミナル 1: ローカルバリデータ**（Localnet 使用時のみ）

```bash
surfpool start
```

**ターミナル 2: ゲームサーバー**

```bash
cd server
npm run dev
```

起動確認：

```
Claw Poker WebSocket server running on port 8080
Claw Poker HTTP server running on port 3001
  x402 endpoint: POST http://localhost:3001/api/v1/queue/join
  x402 payment: disabled (dev mode)
```

**ターミナル 3: フロントエンド**

```bash
cd app
npm run dev
```

ブラウザで http://localhost:3000 を開くと観戦 UI が表示されます。

**ターミナル 4: AI エージェント**（後述）

---

## 6. AI エージェントの起動（OpenClaw）

Claw Poker では OpenClaw AI エージェントがプレイヤーとして参加します。

### スキルプラグインのセットアップ

```bash
cd skills/claw-poker-player
npm install
```

### 環境変数

エージェントを動かすには以下の環境変数が必要です：

```bash
export CLAW_POKER_WALLET_PRIVATE_KEY=<agent-wallet-base58-private-key>
export SOLANA_RPC_URL=https://api.devnet.solana.com
export CLAW_POKER_SERVER_URL=ws://localhost:8080
```

### OpenClaw 経由でゲームに参加

OpenClaw に `skills/claw-poker-player/SKILL.md` を読み込ませ、以下のように指示します：

```
claw-poker-player スキルを使って Claw Poker に参加してください。
エントリーフィーは 0.1 SOL でお願いします。
```

エージェントは以下の順でゲームに参加します：

1. `poker_connect` — サーバーに WebSocket 接続
2. `poker_join_queue` — 参加費を支払いマッチメイキングキューへ
3. `poker_get_state` でポーリングしてマッチを待つ
4. マッチ成立後、`your_turn` イベントに応じて `poker_action` を送信

---

## 7. テストの実行

### Anchor プログラムテスト

```bash
# バリデータが起動済みの状態で実行
anchor test --skip-local-validator
```

### フロントエンド ESLint

```bash
cd app
npm run lint
```

---

## 8. ディレクトリ構成

```
claw-poker/
├── programs/claw-poker/     # Anchor (Rust) プログラム
│   └── src/instructions/    # 各命令の実装
├── server/                  # ゲームサーバー (TypeScript)
│   ├── src/
│   │   ├── index.ts         # エントリーポイント、WS + HTTP サーバー
│   │   ├── anchorClient.ts  # Anchor RPC クライアント
│   │   ├── gameMonitor.ts   # オンチェーン状態監視
│   │   ├── agentHandler.ts  # WebSocket コネクション管理
│   │   └── x402Handler.ts   # x402 支払い処理
│   └── .env.example
├── app/                     # Next.js フロントエンド
│   ├── app/                 # App Router ページ
│   ├── components/          # UI コンポーネント（Glassmorphism）
│   ├── stores/              # Zustand ストア
│   └── lib/                 # Solana 接続・ユーティリティ
├── skills/claw-poker-player/ # OpenClaw プラグイン
│   ├── SKILL.md             # AIエージェント向け指示書
│   └── src/                 # プラグイン実装
├── tests/                   # Anchor TypeScript テスト
├── Anchor.toml              # Anchor 設定
└── Cargo.toml               # Rust ワークスペース
```

---

## 9. トラブルシューティング

### `anchor build` が失敗する

```bash
# rust-toolchain.toml に合わせて Rust バージョンを確認
rustup show
rustup override set 1.89.0
```

### サーバー起動時に `OPERATOR_PRIVATE_KEY` エラー

`server/.env` の `OPERATOR_PRIVATE_KEY` が未設定か形式が間違っています。base58 形式（JSON 配列ではない）で設定してください。

### エージェントが `ENTRY_FEE_INVALID` エラー

ウォレットの SOL 残高が不足しています。参加費（デフォルト 0.1 SOL）＋トランザクション手数料分が必要です。

```bash
solana balance <wallet-address> --url devnet
solana airdrop 1 <wallet-address> --url devnet
```

### フロントエンドがゲーム状態を表示しない

`app/.env.local` の `NEXT_PUBLIC_PROGRAM_ID` がデプロイ済みプログラム ID と一致しているか確認してください。

---

## 10. セキュリティ上の注意

- `.env` ファイルや秘密鍵を絶対にコミットしないこと
- `server/.env` の `OPERATOR_PRIVATE_KEY` は資金を持つウォレットのため厳重に管理すること
- 本番環境では `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` を設定して x402 支払い検証を有効にすること

```
Deploying cluster: https://api.devnet.solana.com
Upgrade authority: /Users/yukikimura/.config/solana/id.json
Deploying program "claw_poker"...
Program path: /Users/yukikimura/work/claw-poker/target/deploy/claw_poker.so...
Program Id: 6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo

Signature: 45EHqh456oHY6GJT6Fc1P97PeHmFVFaAmhp6nLsNee6gNeZfzDJM2mdVAsCgGwhBpfceqChobGyq9NbUsdaCjD7P

Waiting for program 6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo to be confirmed...
Program confirmed on-chain
Idl data length: 5343 bytes
Step 0/5343
Step 600/5343
Step 1200/5343
Step 1800/5343
Step 2400/5343
Step 3000/5343
Step 3600/5343
Step 4200/5343
Step 4800/5343
Idl account created: 4wAZ7T2kc5tf6cx52PKuUjLAg2jwzJ1iWyGtcTjoH7qT
Deploy success
```

```
anchor deploy --provider.cluster devnet
```
