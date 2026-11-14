// -----------------------------------------------------------------------------
// A send-only e-mail channel through the Mailjet Send API v3.1. E-mails leave
// on three paths only, all started by a person:
//   - a Gladys message to a user who entered an address in "My account"
//     (onSendMessage: the "Send a message" scene action, or the system
//     messages the administrator routes to this channel);
//   - the "Send an e-mail with Mailjet" scene action (any address);
//   - the Test button, in sandbox mode: Mailjet checks everything and
//     delivers nothing.
//
// What protects the account and the bill:
//   - an hourly limit (20 by default, 1 to 200), counted before an e-mail
//     leaves and kept in /data (an e-mail that may have left stays counted);
//   - never sent twice: no retry, whatever the answer;
//   - at most 2 requests in flight, 10 waiting, the others refused;
//   - after a throttling (429) or a server error (5xx): a pause (60 s doubled
//     up to 1 h, a Retry-After up to 6 h), kept in /data, on every path, Test
//     included;
//   - keys refused by Mailjet (401): nothing more sent with them (8 bits of a
//     salted hash in /data) until they change or the Test button succeeds.
// Addresses appear masked in the logs ("j***@e***.com"); no key, subject or
// text is ever logged, kept in /data or put in the status.
// Time: the limit and the pauses on the monotonic clock; the wall clock only
// for /data (across a restart) and the times shown to the user.
// -----------------------------------------------------------------------------

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { maskEmail, oneLine, parseEmail, readConfig } from './config.js';
import {
  ACTIONS,
  CONFIG_RETRY_MAX_MS,
  CONFIG_RETRY_MIN_MS,
  CONFIG_WAIT_MS,
  HOUR_MS,
  MAX_ATTACHMENT_BYTES,
  MAX_HOURLY_LIMIT,
  MAX_IN_FLIGHT,
  MAX_SUBJECT,
  MAX_TEXT,
  MAX_WAITING,
  MESSAGE_ACK_MS,
  MESSAGE_READY_MS,
  PAUSE_MAX_MS,
  PAUSE_MIN_MS,
  REQUEST_TIMEOUT_MS,
  RETRY_AFTER_MAX_MS,
  SAVE_BUDGET_MS,
  SCENE_ACTIONS,
  SCENE_DEADLINE_MS,
  STORE_LOAD_BUDGET_MS,
  STORE_RETRY_MS,
  TEST_DEADLINE_MS,
} from './constants.js';
import { bilingual, both } from './i18n.js';
import { MailjetError } from './mailjet.js';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const credsOf = (cfg) => `${cfg.apiKey}\n${cfg.secretKey}`;
export const fp8 = (salt, cfg) => createHmac('sha256', salt).update(credsOf(cfg)).digest()[0];
// Answers that pause every path (Test included): slow down, server failing,
// and the refusals that a new try would only repeat (a 401 without a Mailjet
// key code, a 403): never hammered, never kept as a refusal of the keys.
const PAUSING = new Set(['throttled', 'unavailable', 'unauthorized', 'sender', 'denied']);
// Shown as the plain pause once it is set (their own text says the cause).
const PAUSE_ONLY = new Set(['throttled', 'unavailable']);
// Pauses due to the keys or the sender: lifted when the user changes them.
const SETTINGS_PAUSE = new Set(['unauthorized', 'sender', 'denied']);
const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
// Less than this left before the deadline: not sent (it could not be confirmed).
const MIN_REQUEST_MS = 2_000;

/** An error whose message (English / French) the user sees; `key` is its i18n key. */
class SendError extends Error {
  constructor(key, vars = {}, cause) {
    super(bilingual(key, vars), cause ? { cause } : undefined);
    this.key = key;
  }
}

/** Bounded wait: resolves `fallback` after `ms` if `promise` is slower. */
function within(promise, ms, timers, fallback) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = timers.setTimeout(() => resolve(fallback), Math.max(0, ms));
    }),
  ]).finally(() => timers.clearTimeout(timer));
}

/** The body cleaned: control characters (but tab and line breaks) removed, at most 20,000 characters. */
export function cleanText(text) {
  return (
    String(text ?? '')
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex -- control characters are what it removes
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
      .slice(0, MAX_TEXT)
      .trim()
  );
}

const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/**
 * The image of a Gladys message (`image/jpg;base64,...`, a data URI or bare
 * base64) as a Mailjet attachment; null when absent or not an image we take.
 */
export function attachmentOf(file) {
  if (typeof file !== 'string' || file.length === 0) return null;
  if (file.length > Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 100) return null;
  const match = /^(?:data:)?image\/(jpe?g|png|webp);base64,/i.exec(file);
  const ext = match ? match[1].toLowerCase() : 'jpg';
  const data = (match ? file.slice(match[0].length) : file).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) return null;
  const bytes = (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  if (bytes < 1 || bytes > MAX_ATTACHMENT_BYTES) return null;
  const type = IMAGE_TYPES[ext];
  return {
    ContentType: type,
    Filename: `gladys.${type === 'image/jpeg' ? 'jpg' : ext}`,
    Base64Content: data,
  };
}

export class MailjetApp {
  constructor({
    gladys,
    store,
    mailjet,
    logger = console,
    now = () => performance.now(),
    wallNow = () => Date.now(),
    timers = { setTimeout, clearTimeout },
  }) {
    Object.assign(this, { gladys, store, mailjet, logger, now, wallNow, timers });
    this.stopped = false;
    // Configuration.
    this.config = null; // readConfig() result once read
    this.configRead = false;
    this.configLoop = null;
    this.configTimer = null;
    this.configWaiters = [];
    // /data.
    this.storeReady = false;
    this.loading = null;
    this.storeTimer = null;
    this.firstLoad = null;
    this.sends = []; // monotonic times of the e-mails that left (or may have), last hour
    this.pauseUntil = 0; // monotonic
    this.pauseStep = 0;
    this.pauseGen = 0; // bumped by every pause set
    this.pauseCause = null; // the kind that set the pause (kept in /data)
    this.pauseVars = {};
    this.refused = null; // { salt, fp } (persisted)
    this.refusedFull = null; // sha256 of the refused keys, this process only
    this.succeeded = null; // the keys of the last success, to drop a stale refusal
    // Requests.
    this.inFlight = 0;
    this.waiting = [];
    this.controllers = new Set();
    this.background = new Set(); // Gladys messages still waiting for Mailjet
    // Status.
    this.outcome = 'ready';
    this.outcomeVars = {};
    this.lastStatus = null;
    this.statusTimer = null;
    this.persisted = undefined; // last write to /data: true, false, or none yet
  }

  /** Handlers first, then /data, then the connection. */
  async start() {
    const { gladys } = this;
    gladys.onSendMessage((contact, message) => this.sendMessage(contact, message));
    gladys.onSceneAction(SCENE_ACTIONS.SEND, (fields) => this.sceneSend(fields));
    gladys.onAction(ACTIONS.TEST, async (fields) => this.test(fields));
    gladys.onConfigUpdated(async (raw) => this.applyConfig(raw));
    gladys.on('connected', () => this.onConnected());
    this.firstLoad = this.loadStore();
    await gladys.connect();
  }

  async stop() {
    this.stopped = true;
    for (const timer of [this.configTimer, this.storeTimer, this.statusTimer]) {
      this.timers.clearTimeout(timer);
    }
    for (const w of this.waiting.splice(0)) {
      this.timers.clearTimeout(w.timer);
      w.reject(new SendError('stopped'));
    }
    for (const c of this.controllers) c.abort();
    for (const w of this.configWaiters.splice(0)) w();
    await Promise.allSettled([...this.background]);
    await this.store.flush?.();
  }

  // --- Configuration -----------------------------------------------------------

  /** Every (re)connection: the configuration read again, the status published again. */
  onConnected() {
    this.lastStatus = null;
    this.refreshConfig(CONFIG_RETRY_MIN_MS);
    this.publishStatus();
  }

  /** getConfig() until it answers, 5 s doubled up to 60 s between tries, without end. */
  refreshConfig(delay) {
    if (this.configLoop || this.stopped) return;
    this.timers.clearTimeout(this.configTimer);
    this.configTimer = null;
    this.configLoop = (async () => {
      try {
        const raw = await this.gladys.getConfig();
        if (this.stopped) return;
        this.applyConfig(raw);
      } catch (err) {
        if (this.stopped) return;
        this.logger.warn(`getConfig failed (${err?.name ?? 'error'}); retry in ${delay / 1000} s`);
        this.publishStatus();
        this.configTimer = this.timers.setTimeout(() => {
          this.configTimer = null;
          this.refreshConfig(Math.min(delay * 2, CONFIG_RETRY_MAX_MS));
        }, delay);
      } finally {
        this.configLoop = null;
      }
    })();
  }

  applyConfig(raw) {
    const cfg = readConfig(raw);
    const before = this.config;
    const sameKeys = before?.ok && cfg.ok && credsOf(before) === credsOf(cfg);
    const sameSender = sameKeys && before.senderEmail === cfg.senderEmail;
    this.config = cfg;
    this.configRead = true;
    // Keys or sender changed: the last outcome no longer says anything. The
    // same values saved again keep it (no false reason, no temporary refusal).
    if (!sameSender) {
      this.outcome = 'ready';
      this.outcomeVars = {};
      // A pause set by a 401 or a 403 is about these settings: lifted with
      // them (a 429/5xx pause stays, it is about Mailjet).
      if (before && SETTINGS_PAUSE.has(this.pauseCause) && this.pausedFor() > 0) {
        this.pauseUntil = 0;
        this.pauseStep = 0;
        this.pauseCause = null;
        this.pauseVars = {};
        this.pauseGen += 1;
        this.save();
      }
    }
    for (const w of this.configWaiters.splice(0)) w();
    this.publishStatus();
  }

  /** Waits (bounded by `budget`) for the configuration and the first read of /data. */
  async ready(budget = CONFIG_WAIT_MS) {
    const waits = [];
    if (!this.configRead) {
      if (!this.configLoop && !this.configTimer) this.refreshConfig(CONFIG_RETRY_MIN_MS);
      waits.push(
        within(new Promise((resolve) => this.configWaiters.push(resolve)), budget, this.timers),
      );
    }
    if (!this.storeReady && this.firstLoad) {
      waits.push(within(this.firstLoad, Math.min(budget, STORE_LOAD_BUDGET_MS), this.timers));
    }
    await Promise.all(waits);
    if (this.stopped) throw new SendError('stopped');
    const cfg = this.config;
    if (!cfg) throw new SendError('config_unread');
    if (!cfg.ok) throw new SendError(cfg.reason);
    return cfg;
  }

  // --- /data ------------------------------------------------------------------------

  /** One read at a time; an unreadable /data is read again every 10 s, never overwritten. */
  loadStore() {
    if (this.loading || this.storeReady || this.stopped) return this.loading;
    this.loading = (async () => {
      try {
        const data = await this.store.load();
        if (this.stopped) return;
        this.merge(data);
      } catch (err) {
        if (this.stopped) return;
        this.logger.warn(`/data unreadable (${err?.message ?? 'error'}); read again in 10 s`);
        this.storeTimer = this.timers.setTimeout(() => {
          this.storeTimer = null;
          this.loadStore();
        }, STORE_RETRY_MS);
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /** What /data says, merged with what happened since the start (never lost). */
  merge(data) {
    const now = this.now();
    const wall = this.wallNow();
    const sends = Array.isArray(data?.sends) ? data.sends.slice(-MAX_HOURLY_LIMIT) : [];
    const restored = [];
    for (const at of sends) {
      const ago = wall - at;
      // A future time (clock jumped back, foreign file) is invalid; older than an hour, gone.
      if (Number.isFinite(at) && ago >= 0 && ago < HOUR_MS) restored.push(now - ago);
    }
    this.sends = [...restored, ...this.sends].sort((a, b) => a - b).slice(-MAX_HOURLY_LIMIT);
    const pause = data?.pause;
    if (pause && Number.isFinite(pause.until)) {
      const left = pause.until - wall;
      // A date further than the longest pause is invalid (clock jumped, foreign file).
      if (left > 0 && left <= RETRY_AFTER_MAX_MS) {
        if (now + left > this.pauseUntil) {
          this.pauseUntil = now + left;
          this.pauseCause = PAUSING.has(pause.cause) ? pause.cause : 'throttled';
          this.pauseVars = {};
        }
        this.pauseGen += 1;
      }
      if (isInt(pause.step, PAUSE_MIN_MS, PAUSE_MAX_MS)) {
        this.pauseStep = Math.max(this.pauseStep, pause.step);
      }
    }
    const refused = data?.refused;
    if (
      !this.refused &&
      refused &&
      typeof refused.salt === 'string' &&
      /^[0-9a-f]{32}$/.test(refused.salt) &&
      isInt(refused.fp, 0, 255)
    ) {
      // Keys that succeeded since the start lift a refusal read late.
      const lifted = this.succeeded && fp8(refused.salt, this.succeeded) === refused.fp;
      if (!lifted) this.refused = { salt: refused.salt, fp: refused.fp };
    }
    this.storeReady = true;
    this.save();
    this.publishStatus();
  }

  snapshot() {
    const now = this.now();
    const wall = this.wallNow();
    const left = this.pauseUntil - now;
    return {
      sends: this.recentSends().map((at) => Math.round(wall - (now - at))),
      pause:
        left > 0 || this.pauseStep
          ? { until: wall + Math.max(0, left), step: this.pauseStep, cause: this.pauseCause }
          : null,
      refused: this.refused ? { ...this.refused } : null,
    };
  }

  /** Resolves true once written, false when /data is not read or the write failed. */
  save() {
    if (!this.storeReady) return Promise.resolve(false);
    return this.store.save(this.snapshot()).then(
      () => {
        this.setPersisted(true);
        return true;
      },
      (err) => {
        this.logger.warn(`/data not saved (${err?.message ?? 'error'})`);
        this.setPersisted(false);
        return false;
      },
    );
  }

  setPersisted(value) {
    if (this.persisted === value) return;
    this.persisted = value;
    this.publishStatus();
  }

  // --- Guards -------------------------------------------------------------------------

  isRefused(cfg) {
    if (this.refusedFull) return this.refusedFull === sha256(credsOf(cfg));
    return Boolean(this.refused) && fp8(this.refused.salt, cfg) === this.refused.fp;
  }

  pausedFor() {
    return Math.max(0, this.pauseUntil - this.now());
  }

  /** The e-mails of the last hour (monotonic times), older ones dropped. */
  recentSends() {
    const since = this.now() - HOUR_MS;
    this.sends = this.sends.filter((at) => at > since);
    return this.sends;
  }

  /** The text of the current pause: its own cause for a 401 or a 403, else "paused". */
  pauseReason(left) {
    const cause = this.pauseCause;
    const key = PAUSING.has(cause) && !PAUSE_ONLY.has(cause) ? cause : 'paused';
    return { key, vars: { code: '', ...this.pauseVars, time: this.clockTime(left) } };
  }

  clockTime(left) {
    return new Date(this.wallNow() + left).toISOString().slice(11, 16);
  }

  /** Throws the reason nothing can be sent now (the order is the status order). */
  gate(cfg, { allowRefused = false, counted = true } = {}) {
    if (!allowRefused && this.isRefused(cfg)) throw new SendError('refused');
    const left = this.pausedFor();
    if (left > 0) {
      const { key, vars } = this.pauseReason(left);
      throw new SendError(key, vars);
    }
    if (!counted) return;
    const sends = this.recentSends();
    if (sends.length >= cfg.hourlyLimit) {
      const oldest = sends[sends.length - cfg.hourlyLimit];
      throw new SendError('limit_reached', {
        limit: cfg.hourlyLimit,
        time: this.clockTime(oldest + HOUR_MS - this.now()),
      });
    }
  }

  // --- Queue ----------------------------------------------------------------------------

  acquire(deadline, ticket) {
    if (this.inFlight < MAX_IN_FLIGHT) {
      this.inFlight += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= MAX_WAITING) return Promise.reject(new SendError('busy'));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      const drop = (key) => {
        this.waiting = this.waiting.filter((w) => w !== waiter);
        this.timers.clearTimeout(waiter.timer);
        reject(new SendError(key));
      };
      waiter.timer = this.timers.setTimeout(
        () => drop('busy'),
        Math.max(0, deadline - MIN_REQUEST_MS - this.now()),
      );
      if (ticket) ticket.cancelWait = () => drop('busy');
      this.waiting.push(waiter);
    });
  }

  release() {
    const next = this.waiting.shift();
    if (next) {
      this.timers.clearTimeout(next.timer);
      next.resolve(); // the slot passes on
    } else {
      this.inFlight -= 1;
    }
  }

  // --- Sending ------------------------------------------------------------------------

  /** onSendMessage: a Gladys message to the address of the user's "My account" block. */
  async sendMessage(contact, message) {
    const started = this.now();
    const cfg = await this.ready(MESSAGE_READY_MS);
    // Off by default: the core cannot tell a targeted message from a broadcast
    // (system messages, "Send a message" without a channel, a forgotten
    // password link), so nothing it relays leaves unless the admin said so.
    // Thrown (not returned) so the core log says why.
    if (!cfg.forward) throw new SendError('forward_off');
    const to = parseEmail(contact?.email);
    if (!to) throw new SendError('contact_invalid');
    const text = cleanText(message?.text);
    const attachment = attachmentOf(message?.file);
    if (!text && !attachment) throw new SendError('empty_text');
    if (message?.file && !attachment) {
      this.logger.warn('message image not attached (not a JPEG, PNG or WebP image, or over 2 MB)');
    }
    // Gladys waits 5 s for the ack; Mailjet may take longer. The request goes
    // on in the background (its outcome lands in the status), the ack says
    // where it stands at 3.5 s: never sent twice.
    const ticket = { left: false, cancelled: false };
    const job = this.deliver(cfg, {
      to,
      subject: cfg.subject,
      text: text || '-',
      attachment,
      deadline: this.now() + REQUEST_TIMEOUT_MS + MIN_REQUEST_MS,
      ticket,
      path: 'message',
    });
    this.background.add(job);
    job.then(
      () => this.background.delete(job),
      () => this.background.delete(job),
    );
    const waited = await within(
      job.then(
        () => 'done',
        (err) => ({ err }),
      ),
      Math.max(0, MESSAGE_ACK_MS - (this.now() - started)),
      this.timers,
      'late',
    );
    if (waited === 'done') return undefined;
    if (waited !== 'late') throw waited.err;
    if (!ticket.left) {
      // Still waiting for a slot: given up, nothing sent.
      ticket.cancelled = true;
      ticket.cancelWait?.();
      throw new SendError('busy');
    }
    throw new SendError('pending');
  }

  /** The scene action: one e-mail to one address; outputs the Mailjet message id. */
  async sceneSend(fields = {}) {
    const deadline = this.now() + SCENE_DEADLINE_MS;
    const cfg = await this.ready();
    const to = parseEmail(fields?.to);
    if (!to) throw new SendError('recipient_invalid');
    const text = cleanText(fields?.text);
    if (!text) throw new SendError('empty_text');
    const subject = oneLine(fields?.subject, MAX_SUBJECT) || cfg.subject;
    const { messageId } = await this.deliver(cfg, {
      to,
      subject,
      text,
      deadline,
      path: 'scene',
    });
    return { message_id: messageId };
  }

  /** The Test button: a sandbox send (nothing delivered), even with refused keys (never during a pause). */
  async test(fields = {}) {
    const deadline = this.now() + TEST_DEADLINE_MS;
    const cfg = await this.ready();
    const wanted = typeof fields?.to === 'string' ? fields.to.trim() : '';
    const to = wanted ? parseEmail(wanted) : cfg.senderEmail;
    if (!to) throw new SendError('recipient_invalid');
    const started = this.now();
    await this.deliver(cfg, {
      to,
      subject: bilingual('test_subject'),
      text: bilingual('test_text'),
      deadline,
      sandbox: true,
      path: 'test',
    });
    return both('test_ok', {
      sender: maskEmail(cfg.senderEmail),
      ms: Math.round(this.now() - started),
    });
  }

  /** Gate, queue, gate again, count, send. Never retried. */
  async deliver(startCfg, { to, subject, text, attachment, deadline, sandbox, ticket, path }) {
    const counted = !sandbox;
    this.gate(startCfg, { allowRefused: sandbox, counted });
    await this.acquire(deadline, ticket);
    let mark;
    try {
      if (this.stopped) throw new SendError('stopped');
      if (ticket?.cancelled) throw new SendError('busy');
      // Things may have changed while waiting: the configuration, a refusal, a pause, the limit.
      const cfg = this.config;
      if (!cfg?.ok) throw new SendError(cfg?.reason ?? 'config_unread');
      this.gate(cfg, { allowRefused: sandbox, counted });
      if (deadline - this.now() < MIN_REQUEST_MS) throw new SendError('busy');
      // Counted in memory before it leaves (the limit always holds while the
      // process runs), and written to /data first, 1 s at most: a slow,
      // read-only or unread /data never blocks an alert. The status then says
      // the count is not saved; a crash at that moment may lose this e-mail.
      if (counted) {
        mark = this.now();
        this.sends.push(mark);
        const saved = await within(this.save(), SAVE_BUDGET_MS, this.timers, false);
        if (!saved) this.setPersisted(false);
      }
      if (this.stopped || ticket?.cancelled) {
        this.uncount(mark);
        throw new SendError(this.stopped ? 'stopped' : 'busy');
      }
      const left = Math.min(REQUEST_TIMEOUT_MS, deadline - this.now());
      if (left < MIN_REQUEST_MS) {
        this.uncount(mark);
        throw new SendError('busy');
      }
      const body = this.buildBody(cfg, { to, subject, text, attachment, sandbox });
      if (ticket) ticket.left = true;
      // A pause set while this request was on its way is not lifted by its success.
      const pauseGen = this.pauseGen;
      let result;
      try {
        result = await this.post(cfg, body, left);
      } catch (err) {
        if (err instanceof MailjetError && err.sent === false) this.uncount(mark);
        this.failed(err, cfg, { to, path });
        throw new SendError(this.reasonOf(err), this.varsOf(err), err);
      }
      this.succeededWith(cfg, { to, path, sandbox, pauseGen });
      return result;
    } finally {
      this.release();
    }
  }

  uncount(mark) {
    if (mark === undefined) return;
    const i = this.sends.indexOf(mark);
    if (i >= 0) this.sends.splice(i, 1);
    this.save();
  }

  buildBody(cfg, { to, subject, text, attachment, sandbox }) {
    const from = { Email: cfg.senderEmail };
    if (cfg.senderName) from.Name = cfg.senderName;
    const message = { From: from, To: [{ Email: to }], Subject: subject, TextPart: text };
    if (attachment) message.Attachments = [attachment];
    const body = { Messages: [message] };
    if (sandbox) body.SandboxMode = true;
    return body;
  }

  async post(cfg, body, left) {
    const controller = new AbortController();
    const timer = this.timers.setTimeout(() => controller.abort(), left);
    this.controllers.add(controller);
    try {
      return await this.mailjet.send({
        apiKey: cfg.apiKey,
        secretKey: cfg.secretKey,
        body,
        signal: controller.signal,
      });
    } finally {
      this.timers.clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }

  succeededWith(cfg, { to, path, sandbox, pauseGen }) {
    if (pauseGen === this.pauseGen) {
      this.pauseStep = 0;
      this.pauseUntil = 0;
    }
    this.refused = null;
    this.refusedFull = null;
    this.succeeded = { apiKey: cfg.apiKey, secretKey: cfg.secretKey };
    this.outcome = sandbox ? 'tested' : 'working';
    this.outcomeVars = {};
    this.logger.info(
      sandbox
        ? `sandbox test accepted (${maskEmail(to)})`
        : `e-mail accepted by Mailjet (${path}, to ${maskEmail(to)})`,
    );
    this.save();
    this.publishStatus();
  }

  failed(err, cfg, { to, path }) {
    const kind = err instanceof MailjetError ? err.kind : 'network';
    if (kind === 'refused') {
      const salt = randomBytes(16).toString('hex');
      this.refused = { salt, fp: fp8(salt, cfg) };
      this.refusedFull = sha256(credsOf(cfg));
      this.succeeded = null;
    } else if (PAUSING.has(kind)) {
      this.pauseStep = this.pauseStep ? Math.min(this.pauseStep * 2, PAUSE_MAX_MS) : PAUSE_MIN_MS;
      const asked = Number.isFinite(err.retryAfterMs)
        ? Math.min(err.retryAfterMs, RETRY_AFTER_MAX_MS)
        : 0;
      this.pauseUntil = this.now() + Math.max(this.pauseStep, asked);
      this.pauseGen += 1;
      this.pauseCause = kind;
      this.pauseVars = this.varsOf(err);
    }
    // A refused address or e-mail says nothing about the channel: the status keeps its outcome.
    if (kind !== 'address_invalid' && kind !== 'invalid') {
      this.outcome = kind;
      this.outcomeVars = this.varsOf(err);
    }
    this.logger.warn(
      `e-mail not confirmed (${path}, to ${maskEmail(to)}): ${kind}${err?.code ? ` ${err.code}` : ''}${err?.status ? ` HTTP ${err.status}` : ''}`,
    );
    this.save();
    this.publishStatus();
  }

  reasonOf(err) {
    const kind = err instanceof MailjetError ? err.kind : 'network';
    if (PAUSE_ONLY.has(kind)) return 'paused';
    if (kind === 'network' && err.sent === false) return 'network_not_sent';
    return kind;
  }

  varsOf(err) {
    const kind = err instanceof MailjetError ? err.kind : 'network';
    if (PAUSE_ONLY.has(kind)) return { time: this.clockTime(this.pausedFor()) };
    return {
      time: this.clockTime(this.pausedFor()),
      detail: err?.detail || 'HTTP 400',
      status: err?.status ?? '?',
      code: err?.code ? `, ${err.code}` : '',
    };
  }

  // --- Status -------------------------------------------------------------------------

  status() {
    if (!this.configRead) return { ok: false, key: 'config_unread' };
    const cfg = this.config;
    if (!cfg.ok) return { ok: false, key: cfg.reason };
    if (this.isRefused(cfg)) return { ok: false, key: 'refused' };
    const left = this.pausedFor();
    if (left > 0) {
      // A 401 or a 403 behind the pause: its own text, with the end of the pause.
      return { ok: false, ...this.pauseReason(left), until: left };
    }
    const sends = this.recentSends();
    if (sends.length >= cfg.hourlyLimit) {
      const oldest = sends[sends.length - cfg.hourlyLimit];
      return {
        ok: false,
        key: 'limit_reached',
        vars: { limit: cfg.hourlyLimit, time: this.clockTime(oldest + HOUR_MS - this.now()) },
        until: oldest + HOUR_MS - this.now(),
      };
    }
    // /data not read, read-only or slow: the count is not saved (the limit,
    // the pause and a refusal kept there may also be unknown).
    const good = ['working', 'tested', 'ready'];
    if ((!this.storeReady || this.persisted === false) && good.includes(this.outcome)) {
      return { ok: true, key: 'not_persisted' };
    }
    if (this.outcome === 'working') {
      return { ok: true, key: 'working', vars: { count: sends.length, limit: cfg.hourlyLimit } };
    }
    if (this.outcome === 'tested') return { ok: true, key: 'tested' };
    // A refusal lifted by new keys, a pause over: nothing known against the next e-mail.
    if (this.outcome === 'ready' || this.outcome === 'refused' || PAUSING.has(this.outcome)) {
      return { ok: true, key: 'ready' };
    }
    return { ok: false, key: this.outcome, vars: this.outcomeVars };
  }

  /** A pause or a full hour ends by itself: the status is published again then. */
  scheduleStatus(until) {
    this.timers.clearTimeout(this.statusTimer);
    this.statusTimer = null;
    if (!(until > 0)) return;
    this.statusTimer = this.timers.setTimeout(() => {
      this.statusTimer = null;
      this.publishStatus();
    }, until + 1000);
  }

  /** One setConnectionStatus per change of state. */
  publishStatus() {
    if (this.stopped) return;
    const { ok, key, vars = {}, until } = this.status();
    this.scheduleStatus(until);
    const message = both(key, vars);
    const id = JSON.stringify([ok, message]);
    if (id === this.lastStatus) return;
    this.lastStatus = id;
    Promise.resolve()
      .then(() => this.gladys.setConnectionStatus(ok, message))
      .catch((err) => {
        if (this.lastStatus === id) this.lastStatus = null;
        this.logger.warn(`setConnectionStatus failed (${err?.name ?? 'error'})`);
      });
  }
}
