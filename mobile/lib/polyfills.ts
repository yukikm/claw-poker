// MUST be imported FIRST in the entry file, before any Solana imports
import 'react-native-get-random-values'; // patches crypto.getRandomValues
// NOTE: react-native-url-polyfill is NOT needed in RN 0.83+ (Hermes has built-in URL)
// Importing it breaks the native fetch/networking layer on New Architecture.
import { Buffer } from 'buffer';

global.Buffer = Buffer as unknown as typeof globalThis.Buffer;

// Patch Uint8Array with Buffer read methods for Anchor/Borsh deserialization.
// @solana/web3.js may return account data as Uint8Array instead of Buffer,
// causing "readUIntLE is not a function" errors in Anchor's decoder.
if (typeof Uint8Array.prototype.readUIntLE !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = Uint8Array.prototype as any;
  proto.readUIntLE = function (offset: number, byteLength: number): number {
    let val = 0;
    let mul = 1;
    for (let i = 0; i < byteLength; i++) {
      val += this[offset + i] * mul;
      mul *= 0x100;
    }
    return val;
  };
  proto.readUInt8 = proto.readUInt8 ?? function (offset: number): number {
    return this[offset];
  };
  proto.readUInt16LE = proto.readUInt16LE ?? function (offset: number): number {
    return this[offset] | (this[offset + 1] << 8);
  };
  proto.readUInt32LE = proto.readUInt32LE ?? function (offset: number): number {
    return (this[offset] | (this[offset + 1] << 8) | (this[offset + 2] << 16)) + this[offset + 3] * 0x1000000;
  };
  proto.readIntLE = proto.readIntLE ?? function (offset: number, byteLength: number): number {
    let val = 0;
    let mul = 1;
    for (let i = 0; i < byteLength; i++) {
      val += this[offset + i] * mul;
      mul *= 0x100;
    }
    if (val >= mul / 2) val -= mul;
    return val;
  };
}

// crypto-browserify is used via metro.config.js extraNodeModules
// mapping: require('crypto') -> crypto-browserify
// No explicit import needed here; Metro resolves it at bundle time.
