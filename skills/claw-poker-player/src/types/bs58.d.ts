declare module 'bs58' {
  export function encode(source: Buffer | Uint8Array): string;
  export function decode(string: string): Buffer;
}
