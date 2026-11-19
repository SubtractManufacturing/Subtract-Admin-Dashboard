/** A stable, valid uuid for test fixtures: `testUuid(3)` → `00000000-0000-4000-8000-000000000003`. */
export function testUuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
