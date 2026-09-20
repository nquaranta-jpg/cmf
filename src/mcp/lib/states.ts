import statesJson from "../config/states.json";

const LICENSED = new Set<string>((statesJson as { licensed: string[] }).licensed.map((s) => s.toUpperCase()));

export function isLicensedState(code: string, licensed: Iterable<string> = LICENSED): boolean {
  const set = licensed instanceof Set ? (licensed as Set<string>) : new Set([...licensed].map((s) => s.toUpperCase()));
  return set.has(code.toUpperCase());
}

export function licensedStates(): string[] {
  return [...LICENSED].sort();
}
