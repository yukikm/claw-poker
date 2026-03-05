# Claw Poker Memory

## Known Bug Patterns

### Anchor `bytes` type requires Buffer, not number[]

- Anchor IDL の `"bytes"` 型（Rust `Vec<u8>`）は TypeScript 側で `Buffer` を要求
- `number[]` を渡すと `Blob.encode[data] requires (length N) Buffer as src` エラー
- 修正: `Buffer.from(numberArray)` でラップする
- 該当箇所: `server/src/anchorClient.ts` の `revealCommunityCards` メソッド
- 修正日: 2026-03-05

## Architecture Notes

- サーバーコード: `server/src/index.ts` (Crank 処理), `server/src/anchorClient.ts` (Anchor RPC)
- Crank は `index.ts` でゲーム状態を監視し、フェーズ遷移時に `anchorClient` のメソッドを呼び出す
- `dealCards` 配列: `[burn1, flop0, flop1, flop2, burn2, turn, burn3, river]` (8 要素)
- `as unknown as` キャストパターンが `anchorClient.ts` で多用されている（型安全性の課題）

## MagicBlock ER Transaction Patterns (2026-03-06)

### StructError問題の根本原因と解決済み修正
- MagicBlock ERはVersionedTransactionを返すが、Anchor `.rpc()` 内部のconfirm処理（superstruct）が `accountKeys` パースに失敗しStructErrorが発生
- **解決済み (2026-03-06)**: 全ER向けメソッドで `.rpc()` を `.transaction()` + `sendErTransaction()` ヘルパーに置換。`isErConfirmationStructError()` 関数は削除済み。
- `sendErTransaction()`: `Connection.sendRawTransaction` + `confirmTransaction` で手動送信・確認。`skipPreflight: true` 必須。

### 推奨: ConnectionMagicRouter パターン
```typescript
import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
const connection = new ConnectionMagicRouter(
  "https://devnet-router.magicblock.app/",
  { wsEndpoint: "wss://devnet-router.magicblock.app/" }
);
// skipPreflight: true が必須
const txHash = await sendAndConfirmTransaction(connection, tx, [payer], {
  skipPreflight: true, commitment: "confirmed"
});
```

### 推奨: Anchor `.rpc()` 回避パターン
```typescript
// .rpc() の代わりに .transaction() でTransactionを取得し手動送信
const tx = await program.methods.myInstruction().accounts({...}).transaction();
const sig = await sendAndConfirmTransaction(erConnection, tx, [signer], {
  skipPreflight: true, commitment: "confirmed"
});
```

### TEE (Private ER) パターン
- `verifyTeeRpcIntegrity(rpcUrl)`: TEE RPC の信頼性検証
- `getAuthToken(rpcUrl, publicKey, signMessage)`: TEE認証トークン取得
- 接続: `new Connection(\`${teeRpcUrl}?token=${token}\`, { commitment: 'processed' })`
- Permission Program: `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`
- Permission PDAで読み取りアクセス制御

## Code Review Fixes (2026-03-06)

### StructError後リカバリー修正レビュー

1. **`gameMonitor.ts` burstPollTimersリーク修正**: `unwatchGame()` と `shutdown()` で `burstPollTimers` がクリーンアップされていなかった。ゲーム終了後もバーストポーリングタイマーが動き続けるメモリ/タイマーリーク。
2. **`gameMonitor.ts` triggerBurstPoll off-by-one修正**: `remaining--` が先に実行され、最後のコールバックでポーリングせずreturnしていた（10回指定で9回しか実行されない）。ポーリング実行後にデクリメントするよう修正。
3. **`index.ts` waitingCrankExecutedAtHand リトライ不能バグ修正**: `requestShuffle` 失敗時に `waitingCrankExecutedAtHand.delete()` した直後、内側try-catchの外で `waitingCrankExecutedAtHand.set()` が無条件実行され、VRFリクエスト失敗時のリトライが永久に不可能だった。`.set()` を成功パス内に移動。
4. **`index.ts` 未使用インポート/変数削除**: `ServerMessage`（未使用import）、`DEFAULT_ENTRY_FEE`（未使用定数）を削除。
