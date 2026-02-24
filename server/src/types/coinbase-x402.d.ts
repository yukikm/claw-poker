declare module '@coinbase/x402' {
  interface FacilitatorConfigOptions {
    apiKeyId?: string;
    apiKeySecret?: string;
  }

  interface FacilitatorConfig {
    [key: string]: unknown;
  }

  export function createFacilitatorConfig(opts: FacilitatorConfigOptions): FacilitatorConfig;
}
