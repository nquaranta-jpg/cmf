// Types for visits.mjs (used by tests/visits.test.ts under `npm run typecheck`).

export interface VisitStore {
  get(key: string, opts: { type: "json" }): Promise<any>;
  setJSON(key: string, value: unknown): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
}

export interface VisitRecord { email: string; name: string; source: string; lead_id: string; created: number }
export interface VisitSummary {
  first: number | null; last: number | null; sessions: number; sessionTimes: number[];
  views: number; secs: number; pages: Record<string, number>; lastPath: string; device: string;
  alertAt: number; hour: number; hourCount: number; events: number;
}
export interface VisitAlert {
  token: string; record: VisitRecord; path: string; device: string; ref: string;
  sessionsThisWeek: number; summary: VisitSummary;
}

export const TOKEN_RE: RegExp;
export const EMAIL_RE: RegExp;
export const SITE_ORIGIN: string;
export const SESSION_GAP_MS: number;
export const ALERT_COOLDOWN_MS: number;
export const HOURLY_EVENT_CAP: number;
export const MAX_EVENTS_PER_TOKEN: number;
export const TRACKED_PAGES: string[];
export function pageKey(pathname: string): string;

export function newToken(): string;
export function normEmail(email: unknown): string;
export function cleanPath(p: unknown): string | null;
export function cleanRef(r: unknown): string;
export function deviceOf(ua: unknown): "phone" | "computer";
export function isBotUa(ua: unknown): boolean;
export function tagUrl(url: unknown, token: string): string | null;
export function mint(
  store: VisitStore,
  input: { email?: string; name?: string; source?: string; lead_id?: string },
  now: number,
): Promise<{ error: string } | { token: string; created: boolean; record: VisitRecord; error?: undefined }>;
export function mintMany(
  store: VisitStore,
  rows: { email?: string; name?: string; lead_id?: string; url?: string; source?: string }[],
  opts: { source?: string; url?: string },
  now: number,
): Promise<({ email: string; error: string } | { email: string; name: string; lead_id: string; token: string; created: boolean; link: string | null; error?: undefined })[]>;
export function emptySummary(): VisitSummary;
export function sessionsInLastWeek(sum: VisitSummary, now: number): number;
export function isHot(sum: VisitSummary, now: number): boolean;
export function recordEvent(
  store: VisitStore,
  input: { t?: unknown; type?: unknown; p?: unknown; r?: unknown; s?: unknown; device?: string },
  now: number,
): Promise<
  | { ok: false; reason: string; alert?: undefined }
  | {
      ok: true; alert: VisitAlert | null; reason?: undefined; newVisit: boolean;
      record: VisitRecord; summary: VisitSummary; path: string; device: string; ref: string;
    }
>;
export function appVisitPayload(
  result: { record: VisitRecord; summary: VisitSummary; newVisit: boolean; path: string; device: string; ref: string },
  token: string,
): {
  lead_id: string; email: string; token: string; source: string; new_visit: boolean; path: string; device: string;
  ref: string; sessions: number; views: number; secs: number; first_seen: number | null; last_seen: number | null;
  pages: { path: string; views: number }[];
};
export function alertText(alert: VisitAlert, now: number): string;
export function formatSecs(secs: number): string;
export function listActivity(
  store: VisitStore,
  opts: { days?: number; limit?: number },
  now: number,
): Promise<{ rows: any[]; totals: { people: number; views: number; hot: number }; truncated: boolean }>;
export function history(
  store: VisitStore,
  token: string,
  opts?: { limit?: number },
): Promise<{ token: string; record: VisitRecord; summary: VisitSummary; events: any[] } | null>;
export function findToken(store: VisitStore, email: string): Promise<string | null>;
export function forget(store: VisitStore, input: { token?: string; email?: string }): Promise<{ deleted: number; token?: string; email?: string; lead_id?: string }>;
