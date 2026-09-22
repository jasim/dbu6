declare const __chrono: unique symbol;

export type Chrono<T> = readonly T[] & { readonly [__chrono]: true };

export function chronoMap<T, U>(c: Chrono<T>, f: (t: T) => U): Chrono<U> {
  return c.map(f) as unknown as Chrono<U>;
}

export function chronoFilter<T, U extends T>(
  c: Chrono<T>,
  p: (t: T) => t is U,
): Chrono<U>;
export function chronoFilter<T>(c: Chrono<T>, p: (t: T) => boolean): Chrono<T>;
export function chronoFilter<T>(c: Chrono<T>, p: (t: T) => boolean): Chrono<T> {
  return c.filter(p) as unknown as Chrono<T>;
}

export function chronoConcat<T>(
  head: readonly T[],
  tail: readonly T[],
): Chrono<T> {
  return [...head, ...tail] as unknown as Chrono<T>;
}

export function chronoEmpty<T>(): Chrono<T> {
  return [] as unknown as Chrono<T>;
}

export function unsafeAsChrono<T>(rows: readonly T[]): Chrono<T> {
  return rows as unknown as Chrono<T>;
}
