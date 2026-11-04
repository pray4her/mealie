import { afterAll } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const created: string[] = [];
export async function testDirectory(prefix: string): Promise<string> {
  const parent = join(tmpdir(), 'opencode'); await mkdir(parent, { recursive: true });
  const path = await mkdtemp(join(parent, `miniapp-${prefix}`)); created.push(path); return path;
}
afterAll(async () => {
  // Only exact random directories created by this test process; never their parent.
  await Promise.all(created.map(path => rm(path, { recursive: true, force: true })));
});
