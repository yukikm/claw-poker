declare module 'tweetnacl' {
  namespace sign {
    function detached(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
    namespace detached {
      function verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
    }
    const publicKeyLength: number;
    const secretKeyLength: number;
    const seedLength: number;
    const signatureLength: number;
  }
  export { sign };
}
