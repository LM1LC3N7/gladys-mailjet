// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted Mailjet (no network) and
// the virtual clock: nothing fires by itself, `clock.advance(ms)` moves the
// time and runs the timers due on the way.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MailjetApp } from '../../src/app.js';
import { MailjetError } from '../../src/mailjet.js';
import { createMemoryStore } from '../../src/store.js';
import { settle, testClock } from './clock.js';

export const SELECTOR = 'mailjet';
// Made-up keys of the Mailjet format (32 hexadecimal characters): never real ones.
export const API_KEY = '0123456789abcdef0123456789abcdef';
export const SECRET = 'fedcba9876543210fedcba9876543210';
export const API_KEY_2 = '1111111111abcdef0123456789abcdef';
export const SECRET_2 = '2222222222543210fedcba9876543210';
export const SENDER = 'home@example.com';
export const TO = 'alice.martin@example.org';
export const CONFIG = { api_key: API_KEY, secret_key: SECRET, sender_email: SENDER };
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
// 2026-11-14 10:00 UTC.
export const START = Date.UTC(2026, 10, 14, 10, 0, 0);

export function memoryLogger() {
  const lines = [];
  const log = (level) => (msg) => lines.push(`${level} ${msg}`);
  return { lines, info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') };
}

let ids = 0;
/** A success of the Send API (the message id of the first recipient). */
export const success = () => ({ messageId: `uuid-${(ids += 1)}` });

/**
 * A scripted Mailjet: `answer(call)` -> `{ messageId }` or a promise of it, or
 * throws (a MailjetError). `calls` records every request.
 */
export function fakeMailjet(answer = success) {
  const mailjet = {
    answer,
    calls: [],
    async send(request) {
      mailjet.calls.push(request);
      return mailjet.answer(request);
    },
  };
  return mailjet;
}

/** A promise that never settles unless the signal aborts it. */
export function hangUntilAbort(call) {
  return new Promise((_, reject) => {
    call.signal.addEventListener('abort', () =>
      reject(new MailjetError('timeout', { sent: 'maybe' })),
    );
  });
}

/** A request that waits for `release()` (or the abort). */
export function gate() {
  const waiting = [];
  return {
    waiting,
    answer: (call) =>
      new Promise((resolve, reject) => {
        waiting.push({ call, resolve, reject });
        call.signal.addEventListener('abort', () =>
          reject(new MailjetError('timeout', { sent: 'maybe' })),
        );
      }),
    release(result = success()) {
      waiting.shift()?.resolve(result);
    },
    fail(err) {
      waiting.shift()?.reject(err);
    },
  };
}

export async function makeApp({
  config = CONFIG,
  store = createMemoryStore(),
  mailjet = fakeMailjet(),
  clock = testClock({ start: START }),
  gladys = createFakeGladys({ selector: SELECTOR, config }),
  connect = true,
} = {}) {
  const logger = memoryLogger();
  const app = new MailjetApp({
    gladys,
    store,
    mailjet,
    logger,
    now: clock.monotonic,
    wallNow: clock.now,
    timers: clock.timers,
  });
  if (connect) {
    await app.start();
    await settle();
  }
  return { app, gladys, store, mailjet, clock, logger };
}

/** The last connection status: [connected, english message]. */
export function lastStatus(gladys) {
  const s = gladys.fake.connectionStatus;
  return s ? [s.connected, s.message?.en ?? ''] : undefined;
}

/** Runs the scene action. */
export const sceneSend = (gladys, fields) =>
  gladys.fake.sceneAction('send_email', { to: TO, text: 'The garage door is open', ...fields });

/** A Gladys message to a user whose "My account" address is `email`. */
export const message = (gladys, text = 'Hello from Gladys', email = TO, file = null) =>
  gladys.fake.sendMessage({ email }, { text, file });

export { settle };
