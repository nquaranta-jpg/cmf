// Types for lib/stripe.mjs.

export class StripeError extends Error {
  status: number;
  code?: string;
  type?: string;
}

export interface TaskBoardStripe {
  testMode: boolean;
  createExpressAccount(a: { email: string; workerId: string }): Promise<{ id: string }>;
  accountLink(a: { account: string; refreshUrl: string; returnUrl: string }): Promise<{ url: string }>;
  getAccount(id: string): Promise<any>;
  transfer(a: { amount: number; destination: string; taskId: string; ledgerId: string; attempt?: number }): Promise<{ id: string }>;
  findTransfer(a: { taskId: string; ledgerId: string }): Promise<{ id: string } | null>;
  bondCheckout(a: { workerId: string; cents: number; email: string; successUrl: string; cancelUrl: string }): Promise<{ id: string; url: string }>;
  recentCheckoutSessions(sinceSec: number): Promise<{ data: any[] }>;
  refund(a: { paymentIntent: string; amount: number; idempotencyKey?: string }): Promise<{ id: string }>;
}

export function formEncode(obj: Record<string, unknown>, prefix?: string, out?: URLSearchParams): URLSearchParams;
export function makeStripe(opts?: { key?: string; fetchImpl?: typeof fetch }): TaskBoardStripe | null;
export function accountReady(acct: any): boolean;
export function verifyStripeWebhook(rawBody: string, header: string | null, secret: string | undefined, now?: number, toleranceSec?: number): any | null;
