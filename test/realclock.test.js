// -----------------------------------------------------------------------------
// The app on a REAL moving clock (sped up 20 times): an unreadable /data read
// again every 10 s (never early, a little late under load at most), a Gladys
// message acked at 3.5 s, a scene request aborted at 20 s, nothing left
// running after stop.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MailjetApp } from '../src/app.js';
import { createMemoryStore } from '../src/store.js';
import { realClock, waitFor } from './helpers/clock.js';
import { CONFIG, SELECTOR, TO, fakeMailjet, hangUntilAbort, memoryLogger } from './helpers/app.js';

const SPEED = 20;

test('real clock: /data every 10 s; ack at 3.5 s; request aborted at 20 s; nothing after stop', async (t) => {
  const clock = realClock({ speed: SPEED });
  const store = createMemoryStore();
  store.unreadable = true;
  const reads = [];
  const load = store.load;
  store.load = () => {
    reads.push(clock.monotonic());
    return load();
  };
  const mailjet = fakeMailjet(hangUntilAbort);
  const gladys = createFakeGladys({ selector: SELECTOR, config: CONFIG });
  const app = new MailjetApp({
    gladys,
    store,
    mailjet,
    logger: memoryLogger(),
    now: clock.monotonic,
    wallNow: clock.now,
    timers: clock.timers,
  });
  t.after(async () => {
    await Promise.race([app.stop(), new Promise((resolve) => setTimeout(resolve, 500))]);
    clock.close();
  });
  await app.start();
  const started = clock.monotonic();
  const at = {};
  const ackMessage = gladys.fake
    .sendMessage({ email: TO }, { text: 'Hello', file: null })
    .then((r) => ((at.message = clock.monotonic()), r));
  const ackScene = gladys.fake
    .sceneAction('send_email', { to: TO, text: 'Hello' })
    .then((r) => ((at.scene = clock.monotonic()), r));
  await waitFor(() => reads.length >= 4, '4 reads of /data', 10_000);
  const gaps = reads.slice(1).map((r, i) => r - reads[i]);
  for (const gap of gaps) assert.ok(gap >= 9_900 && gap <= 15_000, `gap ${gap}`);
  const message = await ackMessage;
  assert.equal(message.success, false);
  assert.match(message.error, /no answer yet/);
  const tookMessage = at.message - started;
  assert.ok(tookMessage >= 3_400 && tookMessage <= 4_900, `message ack after ${tookMessage}`);
  const scene = await ackScene;
  assert.equal(scene.success, false);
  const tookScene = at.scene - started;
  assert.ok(tookScene >= 19_900 && tookScene <= 25_000, `scene ack after ${tookScene}`);
  assert.equal(mailjet.calls.length, 2);
  assert.ok(mailjet.calls.every((c) => c.signal.aborted));

  await app.stop();
  const count = reads.length;
  await new Promise((resolve) => setTimeout(resolve, 1500)); // 30 s simulated
  assert.equal(reads.length, count, 'no read after stop');
  assert.equal(mailjet.calls.length, 2, 'never sent again');
  assert.equal(clock.live, 0, 'no timer left');
});
