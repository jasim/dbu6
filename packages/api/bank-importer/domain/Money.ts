// Keep the domain type ergonomic for values assembled from parsed columns.
// The wire schemas in dbu6-shared enforce the directional union at system
// boundaries.
export type Money = {
  withdrawal: number;
  deposit: number;
};

export function isWithdrawal(m: Money): boolean {
  return m.withdrawal > 0;
}
