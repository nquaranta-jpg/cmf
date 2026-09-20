// Small, dependency-free input hygiene shared by both tools.

// Control (Cc), format (Cf: zero-width chars, BOM, bidi marks), line/paragraph separators.
const CONTROL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** Trim, strip control/zero-width characters, and cap length. */
export function cleanString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, "").trim().slice(0, max);
}

/**
 * Normalize a US phone number to E.164 (+1XXXXXXXXXX). Returns null when the
 * input is not a valid 10-digit NANP number.
 */
export function normalizeUsPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  // NANP: area code and exchange cannot start with 0 or 1.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}

export const US_STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME",
  "MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI",
  "SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
]);

export function normalizeState(value: unknown): string {
  return cleanString(value, 4).toUpperCase();
}
