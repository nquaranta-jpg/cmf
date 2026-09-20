import statesJson from "../config/states.json";

const LICENSED = new Set<string>((statesJson as { licensed: string[] }).licensed.map((s) => s.toUpperCase()));

export function isLicensedState(code: string): boolean {
  return LICENSED.has(code.toUpperCase());
}

export function licensedStates(): string[] {
  return [...LICENSED].sort();
}
