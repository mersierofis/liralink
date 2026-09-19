import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** docs/api.types.ts is the source of truth; the backend compiles against a byte-identical copy. */
describe('API contract copy', () => {
  it('is byte-identical to docs/api.types.ts', () => {
    const source = readFileSync(join(__dirname, '../../../docs/api.types.ts'));
    const copy = readFileSync(join(__dirname, 'api.types.ts'));
    expect(copy.equals(source)).toBe(true);
  });
});
