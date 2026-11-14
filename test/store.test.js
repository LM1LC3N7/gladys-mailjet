// -----------------------------------------------------------------------------
// FileStore on a real temporary directory: the hourly count reaches the disk through
// a temporary file synced, a rename, and a sync of the directory (without it
// the rename may be lost on a power cut).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { FileStore, StoreUnreadable } from '../src/store.js';

test('save: temporary file synced, renamed, then the directory synced; mode 0600', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'mailjet-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const events = [];
  const fs = {
    readFile,
    rename: async (from, to) => {
      events.push([
        'rename',
        from === join(dir, 'mailjet.json.tmp') && to === join(dir, 'mailjet.json'),
      ]);
      return rename(from, to);
    },
    open: async (path, ...args) => {
      const handle = await open(path, ...args);
      const kind = path === dir ? 'dir' : 'file';
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        events.push(['sync', kind]);
        return sync();
      };
      return handle;
    },
  };
  const store = new FileStore({ dir, fs });
  await store.save({ sends: [42] });
  assert.deepEqual(events, [
    ['sync', 'file'],
    ['rename', true],
    ['sync', 'dir'],
  ]);
  assert.deepEqual(await store.load(), { sends: [42] });
  assert.deepEqual(await readdir(dir), ['mailjet.json']);
  assert.equal((await stat(join(dir, 'mailjet.json'))).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(join(dir, 'mailjet.json'), 'utf8')).sends[0], 42);
});

test('load: missing is empty; torn is set aside; unreadable or too large is NOT empty', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'mailjet-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new FileStore({ dir });
  assert.deepEqual(await store.load(), {});
  await writeFile(join(dir, 'mailjet.json'), '{"sends":[1');
  assert.deepEqual(await store.load(), {});
  assert.deepEqual((await readdir(dir)).sort(), ['mailjet.json.bad']);
  await writeFile(join(dir, 'mailjet.json'), '[1,2]');
  assert.deepEqual(await store.load(), {});
  await writeFile(join(dir, 'mailjet.json'), ' '.repeat(1024 * 1024 + 1));
  await assert.rejects(store.load(), StoreUnreadable);
  const denied = new FileStore({
    dir,
    fs: {
      readFile: async () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
    },
  });
  await assert.rejects(denied.load(), /unreadable \(EACCES\)/);
});
