import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/** 使用済みエントリーフィー署名をJSONファイルに永続化するストア。
 *  サーバー再起動後も署名の二重使用を防ぐ。
 */
export class SignatureStore {
  private signatures: Set<string>;
  private readonly filePath: string;

  constructor(dataDir: string = join(process.cwd(), 'data')) {
    // データディレクトリが存在しない場合は作成
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.filePath = join(dataDir, 'used_signatures.json');
    this.signatures = new Set<string>();
    this.load();
  }

  has(signature: string): boolean {
    return this.signatures.has(signature);
  }

  add(signature: string): void {
    this.signatures.add(signature);
    this.persist();
  }

  get size(): number {
    return this.signatures.size;
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const arr = JSON.parse(raw) as string[];
        this.signatures = new Set(arr);
        console.log(`[SignatureStore] Loaded ${this.signatures.size} signatures from ${this.filePath}`);
      }
    } catch (err) {
      console.warn('[SignatureStore] Failed to load signatures, starting fresh:', err);
      this.signatures = new Set();
    }
  }

  private persist(): void {
    try {
      // 一時ファイルに書き込んでからリネーム（原子的書き込み）
      const tmp = this.filePath + '.tmp';
      writeFileSync(tmp, JSON.stringify([...this.signatures]), 'utf-8');
      // Node.js の renameSync は同一ファイルシステム上では原子的
      const { renameSync } = require('fs') as typeof import('fs');
      renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[SignatureStore] Failed to persist signatures:', err);
    }
  }
}
