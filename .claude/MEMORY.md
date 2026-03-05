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
