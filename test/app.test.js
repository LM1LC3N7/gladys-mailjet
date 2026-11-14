// -----------------------------------------------------------------------------
// The app: what leaves, when nothing leaves, what is never sent twice, what is
// kept in /data, and what the user reads. Fake Gladys, scripted Mailjet,
// virtual clock (every test moves it).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { attachmentOf, cleanText, fp8 } from '../src/app.js';
import { maskEmail, parseEmail, readConfig } from '../src/config.js';
import { createServer } from 'node:http';
import { MailjetError, createMailjet } from '../src/mailjet.js';
import { createMemoryStore } from '../src/store.js';
import { testClock, waitFor } from './helpers/clock.js';
import {
  API_KEY,
  API_KEY_2,
  CONFIG,
  HOUR,
  MINUTE,
  SECOND,
  SECRET,
  SECRET_2,
  SELECTOR,
  SENDER,
  START,
  TO,
  fakeMailjet,
  gate,
  hangUntilAbort,
  lastStatus,
  makeApp,
  message,
  sceneSend,
  settle,
  success,
} from './helpers/app.js';

const err = (kind, info = {}) => new MailjetError(kind, info);

/** Moves the virtual clock in small steps (the work started by a step sets its own timers). */
async function tick(clock, ms, step = 100) {
  for (let done = 0; done < ms; done += step) await clock.advance(Math.min(step, ms - done));
}

/** Nothing secret or personal in the logs, the statuses or /data. */
function assertClean({ logger, gladys, store }, extra = []) {
  const all = [
    ...logger.lines,
    JSON.stringify(gladys.fake.connectionStatuses),
    JSON.stringify(store.data),
  ].join('\n');
  for (const secret of [API_KEY, SECRET, API_KEY_2, SECRET_2, TO, SENDER, ...extra]) {
    assert.ok(!all.includes(secret), `leaked: ${secret}`);
  }
}

test('the scene action sends one plain-text e-mail and outputs its id', async () => {
  const ctx = await makeApp();
  const { gladys, mailjet, clock } = ctx;
  await clock.advance(SECOND);
  const ack = await sceneSend(gladys, { subject: 'Garage\r\nBcc: x@evil.test', text: 'Open!' });
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.outputs.message_id, /^uuid-\d+$/);
  assert.equal(mailjet.calls.length, 1);
  const call = mailjet.calls[0];
  assert.equal(call.apiKey, API_KEY);
  assert.equal(call.secretKey, SECRET);
  assert.deepEqual(call.body, {
    Messages: [
      {
        From: { Email: SENDER, Name: 'Gladys' },
        To: [{ Email: TO }],
        Subject: 'Garage Bcc: x@evil.test',
        TextPart: 'Open!',
      },
    ],
  });
  assert.deepEqual(lastStatus(gladys), [
    true,
    'Mailjet accepted the last e-mail (1 sent in the last hour, limit 20).',
  ]);
  assert.ok(ctx.logger.lines.some((l) => l.includes('a***@e***.org')));
  assertClean(ctx, ['Open!', 'Garage']);
});

test('the scene action: no recipient, a bad one or no text sends nothing', async () => {
  const { gladys, mailjet, clock } = await makeApp();
  await clock.advance(SECOND);
  for (const fields of [
    { to: '' },
    { to: 'not-an-address' },
    { to: 'a@b' },
    { to: 'a b@example.com' },
    { to: 'x@example.com\r\nBcc: y@example.com' },
    { text: '   ' },
  ]) {
    const ack = await sceneSend(gladys, fields);
    assert.equal(ack.success, false, JSON.stringify(fields));
    assert.match(ack.error, /nothing was sent|Nothing to send/);
  }
  assert.equal(mailjet.calls.length, 0);
});

test('a Gladys message goes to the address of the user, with the camera image attached', async () => {
  const ctx = await makeApp({ config: { ...CONFIG, default_subject: 'Maison', sender_name: '' } });
  const { gladys, mailjet, clock } = ctx;
  await clock.advance(SECOND);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
  const ack = await message(gladys, 'Motion in the **garden**', TO, `image/jpg;base64,${jpeg}`);
  assert.equal(ack.success, true, ack.error);
  const msg = mailjet.calls[0].body.Messages[0];
  assert.deepEqual(msg.From, { Email: SENDER });
  assert.equal(msg.Subject, 'Maison');
  assert.equal(msg.TextPart, 'Motion in the **garden**');
  assert.deepEqual(msg.Attachments, [
    { ContentType: 'image/jpeg', Filename: 'gladys.jpg', Base64Content: jpeg },
  ]);
  assert.equal(mailjet.calls[0].body.SandboxMode, undefined);
  // An image that is not one: the text alone leaves.
  const ack2 = await message(gladys, 'Second', TO, 'image/jpg;base64,@@@');
  assert.equal(ack2.success, true);
  assert.equal(mailjet.calls[1].body.Messages[0].Attachments, undefined);
  // A user whose address is not one: nothing leaves.
  const ack3 = await message(gladys, 'Third', 'nobody');
  assert.equal(ack3.success, false);
  assert.match(ack3.error, /My account/);
  assert.equal(mailjet.calls.length, 2);
  assertClean(ctx, ['garden']);
});

test('the Test button sends in sandbox mode, to the sender by default, and is not counted', async () => {
  const ctx = await makeApp({ config: { ...CONFIG, hourly_limit: 1 } });
  const { gladys, mailjet, clock } = ctx;
  await clock.advance(SECOND);
  mailjet.answer = () => ({ messageId: '' });
  const ack = await gladys.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.message.en, /sandbox mode/);
  assert.match(ack.data.message.en, /h\*\*\*@e\*\*\*\.com/);
  assert.ok(!JSON.stringify(ack.data).includes(SENDER));
  assert.equal(mailjet.calls[0].body.SandboxMode, true);
  assert.deepEqual(mailjet.calls[0].body.Messages[0].To, [{ Email: SENDER }]);
  const ack2 = await gladys.fake.action('test_connection', { to: TO });
  assert.equal(ack2.success, true);
  assert.deepEqual(mailjet.calls[1].body.Messages[0].To, [{ Email: TO }]);
  assert.deepEqual(lastStatus(gladys)[0], true);
  // Not counted: the one e-mail of the hour still leaves.
  mailjet.answer = success;
  assert.equal((await sceneSend(gladys)).success, true);
  assert.equal((await gladys.fake.action('test_connection', { to: 'bad' })).success, false);
  assert.equal(mailjet.calls.length, 3);
});

test('the hourly limit: counted before leaving, kept in /data, sliding over 60 minutes', async () => {
  const store = createMemoryStore();
  const clock = testClock({ start: START });
  const ctx = await makeApp({ config: { ...CONFIG, hourly_limit: 3 }, store, clock });
  const { gladys, mailjet } = ctx;
  for (let i = 0; i < 3; i += 1) {
    await clock.advance(10 * MINUTE);
    assert.equal((await sceneSend(gladys)).success, true);
  }
  const refused = await message(gladys);
  assert.equal(refused.success, false);
  assert.match(
    refused.error,
    /hourly limit of 3 e-mails is reached: nothing more is sent before 11:10/,
  );
  assert.equal(mailjet.calls.length, 3);
  assert.equal(lastStatus(gladys)[0], false);
  assert.equal(store.data.sends.length, 3);
  // Restarted: the count comes back from /data.
  await ctx.app.stop();
  const again = await makeApp({ config: { ...CONFIG, hourly_limit: 3 }, store, clock });
  await clock.advance(SECOND);
  assert.equal((await sceneSend(again.gladys)).success, false);
  assert.equal(again.mailjet.calls.length, 0);
  // The first one leaves the window 60 minutes after it left (11:10).
  await clock.advance(40 * MINUTE - 3 * SECOND);
  assert.equal((await sceneSend(again.gladys)).success, false);
  await clock.advance(3 * SECOND);
  assert.equal((await sceneSend(again.gladys)).success, true);
  assert.equal((await sceneSend(again.gladys)).success, false);
  assert.equal(again.mailjet.calls.length, 1);
  await again.app.stop();
});

test('/data: a future time or a foreign value is not counted; at most 200 kept', async () => {
  const store = createMemoryStore({
    sends: [START + HOUR, START - 2 * HOUR, 'x', null, START - MINUTE],
    pause: { until: START + 7 * HOUR, step: 5 },
    refused: { salt: 'nothex', fp: 3 },
  });
  const ctx = await makeApp({ config: { ...CONFIG, hourly_limit: 2 }, store });
  await ctx.clock.advance(SECOND);
  // Only START - MINUTE counts: one more leaves, no pause, no refusal.
  assert.equal((await sceneSend(ctx.gladys)).success, true);
  assert.equal((await sceneSend(ctx.gladys)).success, false);
  assert.equal(ctx.store.data.sends.length, 2);
  assert.equal(ctx.store.data.pause, null);
  assert.equal(ctx.store.data.refused, null);
  const big = createMemoryStore({ sends: Array.from({ length: 500 }, () => START - MINUTE) });
  const ctx2 = await makeApp({ store: big });
  await ctx2.clock.advance(SECOND);
  assert.ok(ctx2.app.sends.length <= 200);
});

test('never sent twice: one request whatever the answer; counted unless Mailjet refused it', async () => {
  const { gladys, mailjet, clock, app } = await makeApp();
  await clock.advance(SECOND);
  const cases = [
    [err('unconfirmed', { status: 200, sent: 'maybe' }), /may have been sent/, 1],
    [err('network', { sent: 'maybe' }), /may have been sent/, 1],
    [err('network', { sent: false }), /could not be reached \(network\): nothing was sent/, 0],
    [
      err('invalid', { status: 400, sent: false, detail: 'mj-0006' }),
      /mj-0006.*nothing was sent/,
      0,
    ],
    [err('address_invalid', { status: 400, sent: false }), /invalid: nothing was sent/, 0],
    [err('unexpected', { status: 302, sent: 'maybe' }), /HTTP 302/, 1],
    [err('too_large', { status: 200 }), /too large/, 1],
  ];
  for (const [error, pattern, counted] of cases) {
    const before = app.sends.length;
    const calls = mailjet.calls.length;
    mailjet.answer = () => {
      throw error;
    };
    const ack = await sceneSend(gladys);
    assert.equal(ack.success, false);
    assert.match(ack.error, pattern);
    assert.equal(mailjet.calls.length, calls + 1, `${error.kind}: one request`);
    await clock.advance(5 * MINUTE);
    assert.equal(mailjet.calls.length, calls + 1, `${error.kind}: never again`);
    assert.equal(app.sends.length - before, counted, error.kind);
  }
});

test('a request that hangs is aborted before the 30 s of the scene, counted, never sent again', async () => {
  const { gladys, mailjet, clock, app } = await makeApp({ mailjet: fakeMailjet(hangUntilAbort) });
  await clock.advance(SECOND);
  const pending = sceneSend(gladys);
  await settle();
  assert.equal(mailjet.calls.length, 1);
  await clock.advance(19 * SECOND);
  assert.equal(mailjet.calls[0].signal.aborted, false);
  await clock.advance(2 * SECOND);
  const ack = await pending;
  assert.equal(mailjet.calls[0].signal.aborted, true);
  assert.equal(ack.success, false);
  assert.match(ack.error, /did not answer in time: the e-mail may have been sent/);
  assert.equal(app.sends.length, 1);
  await clock.advance(10 * MINUTE);
  assert.equal(mailjet.calls.length, 1);
});

test('keys refused: nothing more sent with them, kept in /data; new keys tried; Test lifts it', async () => {
  const store = createMemoryStore();
  const clock = testClock({ start: START });
  const ctx = await makeApp({ store, clock });
  const { gladys, mailjet } = ctx;
  await clock.advance(SECOND);
  mailjet.answer = () => {
    throw err('refused', { status: 401, sent: false });
  };
  const ack = await sceneSend(gladys);
  assert.match(ack.error, /refused these keys/);
  assert.match(lastStatus(gladys)[1], /refused these keys/);
  assert.equal(lastStatus(gladys)[0], false);
  mailjet.answer = success;
  assert.equal((await sceneSend(gladys)).success, false);
  assert.equal((await message(gladys)).success, false);
  assert.equal(mailjet.calls.length, 1);
  // Kept as 8 bits of a salted hash, never the keys.
  const { salt, fp } = store.data.refused;
  assert.match(salt, /^[0-9a-f]{32}$/);
  assert.equal(fp, fp8(salt, { apiKey: API_KEY, secretKey: SECRET }));
  // The same keys saved again: still refused (no false "ready").
  await gladys.fake.configUpdated({ ...CONFIG, hourly_limit: 10 });
  assert.equal((await sceneSend(gladys)).success, false);
  assert.match(lastStatus(gladys)[1], /refused these keys/);
  // Restarted: still refused.
  await ctx.app.stop();
  const again = await makeApp({ store, clock });
  await clock.advance(SECOND);
  assert.equal((await sceneSend(again.gladys)).success, false);
  assert.equal(again.mailjet.calls.length, 0);
  // The Test button always tries; its success lifts the refusal.
  assert.equal((await again.gladys.fake.action('test_connection', {})).success, true);
  assert.equal(again.store.data.refused, null);
  assert.equal((await sceneSend(again.gladys)).success, true);
  assert.equal(again.mailjet.calls.length, 2);
  await again.app.stop();
});

test('new keys are always tried after a refusal', async () => {
  const { gladys, mailjet, clock } = await makeApp();
  await clock.advance(SECOND);
  mailjet.answer = () => {
    throw err('refused', { status: 401, sent: false });
  };
  await sceneSend(gladys);
  mailjet.answer = success;
  await gladys.fake.configUpdated({ ...CONFIG, api_key: API_KEY_2, secret_key: SECRET_2 });
  assert.equal((await sceneSend(gladys)).success, true);
  assert.equal(mailjet.calls[1].apiKey, API_KEY_2);
  assert.equal(lastStatus(gladys)[0], true);
});

test('a sender not validated or a 403 is not a refusal of the keys, but pauses', async () => {
  const store = createMemoryStore();
  const { gladys, mailjet, clock } = await makeApp({
    store,
    config: { ...CONFIG, hourly_limit: 3 },
  });
  await clock.advance(SECOND);
  mailjet.answer = () => {
    throw err('sender', { status: 403, sent: false, code: 'send-0008' });
  };
  const ack = await sceneSend(gladys);
  assert.match(ack.error, /not the sender address.*Nothing is sent before 10:01 \(UTC\)/);
  assert.match(lastStatus(gladys)[1], /not the sender address.*before 10:01/);
  // Not hammered: 10 more e-mails, no request.
  for (let i = 0; i < 10; i += 1) {
    assert.match((await sceneSend(gladys)).error, /not the sender address.*before 10:01/);
  }
  assert.equal(mailjet.calls.length, 1);
  assert.equal(store.data.refused, null);
  assert.ok(store.data.pause.until > START);
  await clock.advance(61 * SECOND);
  assert.match(lastStatus(gladys)[1], /^Ready\./);
  mailjet.answer = () => {
    throw err('denied', { status: 403, sent: false, code: 'send-0099' });
  };
  assert.match((await sceneSend(gladys)).error, /denied the sending \(HTTP 403, send-0099\)/);
  await clock.advance(61 * SECOND);
  assert.equal((await sceneSend(gladys)).success, false, 'step doubled: 120 s');
  await clock.advance(60 * SECOND);
  mailjet.answer = success;
  assert.equal((await sceneSend(gladys)).success, true);
  assert.equal(mailjet.calls.length, 3);
});

test('429 and 5xx: a pause on every path, Retry-After honored, kept in /data', async () => {
  const store = createMemoryStore();
  const clock = testClock({ start: START });
  const ctx = await makeApp({ store, clock });
  const { gladys, mailjet } = ctx;
  await clock.advance(SECOND);
  mailjet.answer = () => {
    throw err('throttled', { status: 429, sent: false, retryAfterMs: 5 * MINUTE });
  };
  const ack = await sceneSend(gladys);
  assert.match(ack.error, /nothing is sent before 10:05 \(UTC\)/);
  mailjet.answer = success;
  assert.equal((await sceneSend(gladys)).success, false);
  assert.equal((await message(gladys)).success, false);
  assert.equal((await gladys.fake.action('test_connection', {})).success, false);
  assert.equal(mailjet.calls.length, 1);
  assert.ok(store.data.pause.until > START + 4 * MINUTE);
  // Restarted inside the pause: still paused.
  await ctx.app.stop();
  const again = await makeApp({ store, clock });
  await clock.advance(2 * MINUTE);
  assert.equal((await sceneSend(again.gladys)).success, false);
  await clock.advance(3 * MINUTE);
  assert.equal((await sceneSend(again.gladys)).success, true);
  // A 5xx: 60 s doubled each time (the step was reset by the success).
  again.mailjet.answer = () => {
    throw err('unavailable', { status: 503 });
  };
  await sceneSend(again.gladys);
  await clock.advance(61 * SECOND);
  await sceneSend(again.gladys);
  await clock.advance(61 * SECOND);
  again.mailjet.answer = success;
  assert.equal((await sceneSend(again.gladys)).success, false, 'paused 120 s');
  await clock.advance(60 * SECOND);
  assert.equal((await sceneSend(again.gladys)).success, true);
  // A Retry-After of 2 days is held to 6 hours.
  again.mailjet.answer = () => {
    throw err('throttled', { status: 429, sent: false, retryAfterMs: 48 * HOUR });
  };
  await sceneSend(again.gladys);
  again.mailjet.answer = success;
  await clock.advance(6 * HOUR - MINUTE);
  assert.equal((await sceneSend(again.gladys)).success, false);
  await clock.advance(2 * MINUTE);
  assert.equal((await sceneSend(again.gladys)).success, true);
  await again.app.stop();
});

test('a Gladys message acked within 3.5 s; a slow Mailjet answers later, never twice', async () => {
  const slow = gate();
  const { gladys, mailjet, clock } = await makeApp({ mailjet: fakeMailjet(slow.answer) });
  await clock.advance(SECOND);
  const pending = message(gladys);
  await settle();
  assert.equal(slow.waiting.length, 1);
  await clock.advance(3400);
  let acked = false;
  pending.then(() => (acked = true));
  await settle();
  assert.equal(acked, false);
  await clock.advance(200);
  const ack = await pending;
  assert.equal(ack.success, false);
  assert.match(ack.error, /no answer yet: it is not sent again/);
  // Mailjet answers 5 s later: the status says so.
  await clock.advance(5 * SECOND);
  slow.release();
  await settle();
  assert.equal(lastStatus(gladys)[0], true);
  assert.match(lastStatus(gladys)[1], /accepted the last e-mail/);
  assert.equal(mailjet.calls.length, 1);
});

test('a Gladys message still waiting for a slot at 3.5 s is given up, never sent later', async () => {
  const slow = gate();
  const { gladys, mailjet, clock, app } = await makeApp({ mailjet: fakeMailjet(slow.answer) });
  await clock.advance(SECOND);
  const scenes = [sceneSend(gladys), sceneSend(gladys)];
  await settle();
  assert.equal(slow.waiting.length, 2);
  const pending = message(gladys);
  await tick(clock, 3600);
  const ack = await pending;
  assert.match(ack.error, /Too many e-mails at once: this one was not sent/);
  slow.release();
  slow.release();
  await Promise.all(scenes);
  await clock.advance(MINUTE);
  assert.equal(mailjet.calls.length, 2);
  assert.equal(app.sends.length, 2);
  assert.equal(app.waiting.length, 0);
});

test('a scene sending 5 e-mails through a slow Mailjet (500-900 ms): all 5 leave', async () => {
  const delays = [900, 500, 700, 800, 600];
  const mailjet = fakeMailjet(
    (call) =>
      new Promise((resolve) => {
        clock.timers.setTimeout(() => resolve(success()), delays[mailjet.calls.length - 1]);
        call.signal.addEventListener('abort', () => resolve(undefined));
      }),
  );
  const clock = testClock({ start: START });
  const { gladys } = await makeApp({ mailjet, clock });
  await clock.advance(SECOND);
  const acks = [1, 2, 3, 4, 5].map((i) => sceneSend(gladys, { to: `user${i}@example.com` }));
  await tick(clock, 5 * SECOND);
  const results = await Promise.all(acks);
  assert.deepEqual(
    results.map((r) => r.success),
    [true, true, true, true, true],
  );
  assert.equal(mailjet.calls.length, 5);
  // One in 5xx does not stop the others.
  let n = 0;
  mailjet.answer = () => {
    n += 1;
    if (n === 1) throw err('invalid', { status: 400, sent: false });
    return success();
  };
  const more = await Promise.all([sceneSend(gladys), sceneSend(gladys), sceneSend(gladys)]);
  assert.deepEqual(
    more.map((r) => r.success),
    [false, true, true],
  );
});

test('too many at once: 2 in flight, 10 waiting, the next one refused without sending', async () => {
  const slow = gate();
  const { gladys, mailjet, clock } = await makeApp({
    mailjet: fakeMailjet(slow.answer),
    config: { ...CONFIG, hourly_limit: 50 },
  });
  await clock.advance(SECOND);
  const acks = Array.from({ length: 12 }, () => sceneSend(gladys));
  await settle();
  const extra = await sceneSend(gladys);
  assert.match(extra.error, /Too many e-mails at once/);
  for (let i = 0; i < 12; i += 1) {
    slow.release();
    await settle();
  }
  const results = await Promise.all(acks);
  assert.ok(results.every((r) => r.success));
  assert.equal(mailjet.calls.length, 12);
  await clock.advance(SECOND);
});

test('getConfig failing in connected: retried, spaced, without end; then ready', async () => {
  const gladys = createFakeGladys({ selector: SELECTOR, config: CONFIG });
  const real = gladys.getConfig.bind(gladys);
  // Call 1 is the resynchronization of the SDK; ours fail 3 times (2 to 4).
  let calls = 0;
  gladys.getConfig = async () => {
    calls += 1;
    if (calls >= 2 && calls <= 4) throw new Error('down');
    return real();
  };
  const { clock, app } = await makeApp({ gladys });
  assert.equal(calls, 2);
  assert.deepEqual(lastStatus(gladys), [
    false,
    'The configuration could not be read from Gladys yet; trying again.',
  ]);
  await clock.advance(4 * SECOND);
  assert.equal(calls, 2);
  await clock.advance(SECOND);
  assert.equal(calls, 3);
  await clock.advance(9 * SECOND);
  assert.equal(calls, 3, 'spaced: 10 s after the second failure');
  await clock.advance(SECOND + 20 * SECOND);
  assert.equal(calls, 5);
  assert.equal(app.configRead, true);
  assert.deepEqual(lastStatus(gladys)[0], true);
  assert.match(lastStatus(gladys)[1], /^Ready\./);
  // A reconnection reads it again.
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  assert.equal(calls, 7);
});

test('/data unreadable: read again every 10 s, never written before, sending goes on', async () => {
  const store = createMemoryStore({ sends: [START - MINUTE] });
  store.unreadable = true;
  const { gladys, mailjet, clock, app } = await makeApp({ store });
  await clock.advance(SECOND);
  assert.equal(store.saves, 0);
  const ack = await sceneSend(gladys);
  assert.equal(ack.success, true);
  assert.equal(store.saves, 0, 'never written before it is read');
  assert.match(lastStatus(gladys)[1], /hourly counter is not saved/);
  const loads = store.loads;
  await clock.advance(8 * SECOND);
  assert.equal(store.loads, loads);
  await clock.advance(2 * SECOND);
  assert.equal(store.loads, loads + 1);
  store.unreadable = false;
  await clock.advance(10 * SECOND);
  assert.equal(app.storeReady, true);
  // Merged: the e-mail of /data and the one sent since.
  assert.equal(store.data.sends.length, 2);
  assert.match(lastStatus(gladys)[1], /accepted the last e-mail \(2 sent/);
  assert.equal(mailjet.calls.length, 1);
});

test('/data hanging or read-only never blocks a message beyond its ack', async () => {
  const store = createMemoryStore();
  store.hang = true;
  const { gladys, mailjet, clock } = await makeApp({ store });
  const pending = message(gladys);
  await clock.advance(3 * SECOND);
  const ack = await pending;
  assert.equal(ack.success, true, ack.error);
  assert.equal(mailjet.calls.length, 1);
  const ro = createMemoryStore();
  ro.failSave = true;
  const ctx = await makeApp({ store: ro });
  await ctx.clock.advance(SECOND);
  assert.equal((await sceneSend(ctx.gladys)).success, true);
  assert.match(lastStatus(ctx.gladys)[1], /hourly counter is not saved/);
});

test('stop: requests aborted, waiting ones refused, no timer left', async () => {
  const clock = testClock({ start: START });
  const { gladys, mailjet, app } = await makeApp({ mailjet: fakeMailjet(hangUntilAbort), clock });
  await clock.advance(SECOND);
  const acks = [sceneSend(gladys), sceneSend(gladys), sceneSend(gladys)];
  await settle();
  await app.stop();
  const results = await Promise.all(acks);
  assert.ok(results.every((r) => !r.success));
  assert.ok(mailjet.calls.every((c) => c.signal.aborted));
  assert.equal(mailjet.calls.length, 2);
  await waitFor(() => clock.pending === 0, 'no timer left', 1000);
});

test('the configuration: keys in pairs, strict limit, addresses checked', () => {
  assert.equal(readConfig({}).reason, 'not_configured');
  assert.equal(readConfig({ api_key: API_KEY }).reason, 'secret_missing');
  assert.equal(readConfig({ secret_key: SECRET }).reason, 'api_key_missing');
  assert.equal(readConfig({ ...CONFIG, api_key: 'abc def' }).reason, 'api_key_invalid');
  assert.equal(readConfig({ ...CONFIG, secret_key: `${SECRET}\n` }).ok, true);
  assert.equal(readConfig({ ...CONFIG, secret_key: 'ab\ncd'.repeat(5) }).reason, 'secret_invalid');
  assert.equal(readConfig({ ...CONFIG, sender_email: '' }).reason, 'sender_missing');
  assert.equal(readConfig({ ...CONFIG, sender_email: 'me@localhost' }).reason, 'sender_invalid');
  for (const bad of ['1.5', '0', '201', 'ten', 2.5, -1, ' 1 2']) {
    assert.equal(readConfig({ ...CONFIG, hourly_limit: bad }).reason, 'limit_invalid', `${bad}`);
  }
  for (const [value, limit] of [
    ['', 20],
    [null, 20],
    ['7', 7],
    [200, 200],
    [1, 1],
  ]) {
    assert.equal(readConfig({ ...CONFIG, hourly_limit: value }).hourlyLimit, limit);
  }
  const cfg = readConfig({ ...CONFIG, sender_name: ' Home\nsweet ', default_subject: '' });
  assert.equal(cfg.senderName, 'Home sweet');
  assert.equal(cfg.subject, 'Gladys');
  assert.equal(readConfig(CONFIG).senderName, 'Gladys');
  assert.equal(
    parseEmail(' Jean.Dupont+alarm@sub.example.fr '),
    'Jean.Dupont+alarm@sub.example.fr',
  );
  for (const bad of [
    'a@b.c',
    'a@-b.com',
    'a@b..com',
    '@b.com',
    'a@@b.com',
    'a@[1.2.3.4]',
    'a@1.2.3.4',
    `${'x'.repeat(65)}@b.com`,
  ]) {
    assert.equal(parseEmail(bad), null, bad);
  }
  assert.equal(maskEmail('jean.dupont@example.fr'), 'j***@e***.fr');
  assert.equal(maskEmail('nothing'), '***');
});

test('texts and images cleaned', () => {
  assert.equal(cleanText('a\u0000b\r\nc\u001b'), 'a b\nc');
  assert.equal(cleanText('x'.repeat(30_000)).length, 20_000);
  const png = Buffer.from('fake png').toString('base64');
  assert.equal(attachmentOf(`data:image/png;base64,${png}`).ContentType, 'image/png');
  assert.equal(attachmentOf(png).ContentType, 'image/jpeg');
  assert.equal(attachmentOf('image/gif;base64,R0lGOD'), null);
  assert.equal(attachmentOf('a'.repeat(3 * 1024 * 1024)), null);
  assert.equal(attachmentOf(''), null);
  assert.equal(attachmentOf(null), null);
});

test('the limit checked again after waiting for a slot: the third of 3 at once is refused', async () => {
  const slow = gate();
  const { gladys, mailjet, clock } = await makeApp({
    mailjet: fakeMailjet(slow.answer),
    config: { ...CONFIG, hourly_limit: 2 },
  });
  await clock.advance(SECOND);
  const acks = [sceneSend(gladys), sceneSend(gladys), sceneSend(gladys)];
  await settle();
  assert.equal(slow.waiting.length, 2);
  slow.release();
  slow.release();
  const results = await Promise.all(acks);
  assert.deepEqual(
    results.map((r) => r.success),
    [true, true, false],
  );
  assert.match(results[2].error, /hourly limit of 2/);
  assert.equal(mailjet.calls.length, 2);
});

test('keys refused while others waited: the waiting ones are not sent', async () => {
  const slow = gate();
  const { gladys, mailjet, clock } = await makeApp({ mailjet: fakeMailjet(slow.answer) });
  await clock.advance(SECOND);
  const acks = [sceneSend(gladys), sceneSend(gladys), sceneSend(gladys)];
  await settle();
  slow.fail(err('refused', { status: 401, sent: false }));
  await settle();
  slow.release();
  const results = await Promise.all(acks);
  assert.deepEqual(
    results.map((r) => r.success),
    [false, true, false],
  );
  assert.match(results[2].error, /refused these keys/);
  assert.equal(mailjet.calls.length, 2);
});

test('a slot taken just before the ack, /data slow: the message given up never leaves', async () => {
  const slow = gate();
  const store = createMemoryStore();
  const { gladys, mailjet, clock, app } = await makeApp({
    mailjet: fakeMailjet(slow.answer),
    store,
  });
  await clock.advance(SECOND);
  const scenes = [sceneSend(gladys), sceneSend(gladys)];
  await settle();
  const pending = message(gladys);
  await tick(clock, 3000);
  // /data now hangs: the message gets its slot, then waits 1 s for the write.
  store.save = () => new Promise(() => {});
  slow.release();
  await tick(clock, 600);
  const ack = await pending;
  assert.match(ack.error, /Too many e-mails at once: this one was not sent/);
  await tick(clock, 2000);
  slow.release();
  await Promise.all(scenes);
  assert.equal(mailjet.calls.length, 2);
  assert.equal(app.sends.length, 2, 'given back');
});

test('the status comes back by itself when a pause or the full hour ends', async () => {
  const { gladys, mailjet, clock } = await makeApp({ config: { ...CONFIG, hourly_limit: 1 } });
  await clock.advance(SECOND);
  assert.equal((await sceneSend(gladys)).success, true);
  assert.match(lastStatus(gladys)[1], /hourly limit of 1 e-mails is reached/);
  await clock.advance(HOUR + 2 * SECOND);
  assert.deepEqual(lastStatus(gladys), [
    true,
    'Mailjet accepted the last e-mail (0 sent in the last hour, limit 1).',
  ]);
  mailjet.answer = () => {
    throw err('throttled', { status: 429, sent: false });
  };
  await gladys.fake.action('test_connection', {});
  assert.match(lastStatus(gladys)[1], /slow down/);
  await clock.advance(62 * SECOND);
  assert.equal(lastStatus(gladys)[0], true);
  assert.match(lastStatus(gladys)[1], /^Ready\./);
});

test('Gladys messages: nothing leaves unless the option is exactly on; scene and Test do not need it', async () => {
  for (const value of [undefined, false, 'false', '', 0, 1, 'yes', null]) {
    const config = { ...CONFIG, forward_gladys_messages: value };
    const { gladys, mailjet, clock, app } = await makeApp({ config });
    await clock.advance(SECOND);
    // Even a bad address and an empty text: the option is checked first.
    for (const ack of [await message(gladys), await message(gladys, '', 'bad')]) {
      assert.equal(ack.success, false, String(value));
      assert.match(ack.error, /option “Also send the Gladys messages” off/);
    }
    assert.equal(mailjet.calls.length, 0);
    assert.equal(app.sends.length, 0);
    assert.equal(lastStatus(gladys)[0], true);
    assert.equal((await sceneSend(gladys)).success, true);
    assert.equal((await gladys.fake.action('test_connection', {})).success, true);
    await app.stop();
  }
  for (const value of [true, 'true']) {
    const { gladys, mailjet, clock } = await makeApp({
      config: { ...CONFIG, forward_gladys_messages: value },
    });
    await clock.advance(SECOND);
    assert.equal((await message(gladys)).success, true);
    assert.equal(mailjet.calls.length, 1);
  }
});

test('a pause set while another request was on its way is not lifted by its success', async () => {
  const slow = gate();
  const { gladys, mailjet, clock } = await makeApp({ mailjet: fakeMailjet(slow.answer) });
  await clock.advance(SECOND);
  const a = sceneSend(gladys);
  const b = sceneSend(gladys);
  await settle();
  assert.equal(slow.waiting.length, 2);
  // The first answered 429, the second (already gone) then succeeds.
  slow.fail(err('throttled', { status: 429, sent: false }));
  await settle();
  slow.release();
  assert.equal((await a).success, false);
  assert.equal((await b).success, true);
  const third = await sceneSend(gladys);
  assert.match(third.error, /slow down or failed/);
  assert.equal(mailjet.calls.length, 2);
  assert.match(lastStatus(gladys)[1], /slow down/);
  await clock.advance(61 * SECOND);
  mailjet.answer = success;
  assert.equal((await sceneSend(gladys)).success, true);
});

test('the pause step doubles up to 1 hour, never beyond, also in /data', async () => {
  const store = createMemoryStore();
  const { gladys, mailjet, clock, app } = await makeApp({ store });
  await clock.advance(SECOND);
  mailjet.answer = () => {
    throw err('unavailable', { status: 503 });
  };
  for (let i = 0; i < 8; i += 1) {
    await sceneSend(gladys);
    const left = app.pausedFor();
    assert.ok(left <= HOUR, `failure ${i + 1}: ${left}`);
    await clock.advance(left + SECOND);
  }
  assert.equal(app.pauseStep, HOUR);
  await sceneSend(gladys);
  assert.equal(store.data.pause.step, HOUR);
  assert.ok(store.data.pause.until - (START + clock.elapsed) <= HOUR + SECOND);
  assert.equal(mailjet.calls.length, 9);
});

test('the real client: a connection cut after the request stays counted; a refused one is given back', async (t) => {
  const srv = createServer((req) => req.on('data', () => {}).on('end', () => req.socket.destroy()));
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections();
    return new Promise((resolve) => srv.close(resolve));
  });
  const url = `http://127.0.0.1:${srv.address().port}/v3.1/send`;
  const store = createMemoryStore();
  const { gladys, app } = await makeApp({ store, mailjet: createMailjet({ userAgent: 't', url }) });
  const ack = await sceneSend(gladys);
  assert.equal(ack.success, false);
  assert.match(ack.error, /may have been sent/);
  assert.equal(app.sends.length, 1);
  await settle();
  assert.equal(store.data.sends.length, 1);
  // A port that refuses: nothing left, given back.
  const closed = createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  app.mailjet = createMailjet({ userAgent: 't', url: `http://127.0.0.1:${port}/v3.1/send` });
  const refused = await sceneSend(gladys);
  assert.match(refused.error, /nothing was sent/);
  assert.equal(app.sends.length, 1);
  await settle();
  assert.equal(store.data.sends.length, 1);
});

test('a 401 without a Mailjet key code: not kept as a refusal, but a pause (Test included)', async () => {
  const store = createMemoryStore();
  const { gladys, mailjet, clock } = await makeApp({
    store,
    config: { ...CONFIG, hourly_limit: 3 },
  });
  await clock.advance(SECOND);
  mailjet.answer = () => {
    throw err('unauthorized', { status: 401, sent: false });
  };
  const first = await sceneSend(gladys);
  assert.match(first.error, /without a Mailjet error code.*nothing is sent before 10:01 \(UTC\)/);
  for (let i = 0; i < 9; i += 1) assert.equal((await sceneSend(gladys)).success, false);
  assert.equal((await gladys.fake.action('test_connection', {})).success, false);
  assert.equal(mailjet.calls.length, 1, '10 e-mails, 1 request');
  assert.match(lastStatus(gladys)[1], /without a Mailjet error code/);
  assert.equal(store.data.refused, null);
  assert.ok(store.data.pause);
  await clock.advance(61 * SECOND);
  mailjet.answer = success;
  assert.equal((await sceneSend(gladys)).success, true);
  assert.equal(mailjet.calls.length, 2);
});

test('a 401/403 pause: lifted by new keys or sender, kept with its cause across a restart; a 429 pause stays', async () => {
  const store = createMemoryStore();
  const clock = testClock({ start: START });
  const ctx = await makeApp({ store, clock });
  const { gladys, mailjet } = ctx;
  await clock.advance(SECOND);
  mailjet.answer = () => {
    throw err('sender', { status: 403, sent: false, code: 'send-0008' });
  };
  await sceneSend(gladys);
  assert.equal(store.data.pause.cause, 'sender');
  // The same settings saved again: still paused, with its cause.
  await gladys.fake.configUpdated({ ...CONFIG });
  assert.match((await sceneSend(gladys)).error, /not the sender address/);
  // Restarted: the cause comes back from /data.
  await ctx.app.stop();
  const again = await makeApp({ store, clock });
  await clock.advance(SECOND);
  assert.match(lastStatus(again.gladys)[1], /not the sender address.*before 10:01/);
  assert.match((await sceneSend(again.gladys)).error, /not the sender address/);
  assert.equal(again.mailjet.calls.length, 0);
  // A new sender: the pause is lifted at once.
  await again.gladys.fake.configUpdated({ ...CONFIG, sender_email: 'other@example.com' });
  assert.match(lastStatus(again.gladys)[1], /^Ready\./);
  assert.equal((await sceneSend(again.gladys)).success, true);
  assert.equal(again.store.data.pause, null);
  // A 401 without code, then new keys: lifted too.
  again.mailjet.answer = () => {
    throw err('unauthorized', { status: 401, sent: false });
  };
  await sceneSend(again.gladys);
  again.mailjet.answer = success;
  await again.gladys.fake.configUpdated({
    ...CONFIG,
    sender_email: 'other@example.com',
    api_key: API_KEY_2,
    secret_key: SECRET_2,
  });
  assert.equal((await sceneSend(again.gladys)).success, true);
  // A 429 pause is about Mailjet: new keys do not lift it.
  again.mailjet.answer = () => {
    throw err('throttled', { status: 429, sent: false });
  };
  await sceneSend(again.gladys);
  again.mailjet.answer = success;
  await again.gladys.fake.configUpdated({ ...CONFIG });
  assert.match((await sceneSend(again.gladys)).error, /slow down or failed/);
  assert.equal(again.mailjet.calls.length, 4);
  await again.app.stop();
});
