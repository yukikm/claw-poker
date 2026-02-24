declare module 'x402-express' {
  import type { RequestHandler } from 'express';

  interface RouteConfig {
    price: string;
    network: string;
    config?: Record<string, string>;
  }

  interface PaymentMiddlewareOptions {
    facilitator?: unknown;
  }

  export function paymentMiddleware(
    recipient: string,
    routes: Record<string, RouteConfig>,
    options?: PaymentMiddlewareOptions,
  ): RequestHandler;
}
