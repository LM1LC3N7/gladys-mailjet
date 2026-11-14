// -----------------------------------------------------------------------------
// The Mailjet Send API v3.1 client: one POST, its answer read within 64 KB and
// classified. Never retried here: an e-mail that may have left is never sent
// twice (the caller decides nothing more is sent).
//
// Answers (https://dev.mailjet.com/docs/email-api/send-api-v31/send-api-errors):
//   200 + Messages[0].Status "success"  sent (or accepted in sandbox mode)
//   401 (mj-0001 suspended, mj-0015 bad credentials)  the keys are refused
//   403 send-0006/0007/0008  the sender is not validated (not a key refusal)
//   400  the message was refused (address, size...): nothing sent
//   429 / 5xx  slow down / Mailjet failing: the caller pauses
// A 401 whose body is not Mailjet's (a proxy page, a cut answer) is not a
// refusal of the keys.
// -----------------------------------------------------------------------------

import { API_URL, MAX_RESPONSE_BYTES } from './constants.js';

/** Connection errors that prove nothing reached Mailjet. */
const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);
const SENDER_CODES = new Set(['send-0006', 'send-0007', 'send-0008']);
const KEY_CODES = new Set(['mj-0001', 'mj-0015']);
const CODE = /^[a-z]{2,8}-\d{4}$/;

export class MailjetError extends Error {
  /**
   * @param {string} kind refused | sender | denied | address_invalid | invalid |
   *   throttled | unavailable | unconfirmed | unexpected | too_large | timeout | network
   * @param {object} info sent: false (nothing left), true or 'maybe'
   */
  constructor(kind, { status, code = '', sent = 'maybe', retryAfterMs, detail = '' } = {}) {
    super(`Mailjet: ${kind}${status ? ` (HTTP ${status})` : ''}${code ? ` ${code}` : ''}`);
    this.name = 'MailjetError';
    Object.assign(this, { kind, status, code, sent, retryAfterMs, detail });
  }
}

/** Retry-After in ms: seconds, or an HTTP date compared to the Date of the answer. */
export function retryAfterMs(value, dateHeader) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (/^\d{1,9}$/.test(v)) return Number(v) * 1000;
  const until = Date.parse(v);
  const at = Date.parse(typeof dateHeader === 'string' ? dateHeader : '');
  // Without a readable Date, the server time is unknown: no deadline from it.
  if (!Number.isFinite(until) || !Number.isFinite(at)) return undefined;
  return Math.max(0, until - at);
}

/** The body, at most `max` bytes; throws 'too_large' beyond (the rest is never read). */
async function readBounded(response, max) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new MailjetError('too_large', { status: response.status });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(text) {
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** The error codes of an answer (global or per message), well-formed only. */
export function errorCodes(data) {
  const codes = [];
  const add = (code) => {
    if (typeof code === 'string' && CODE.test(code) && !codes.includes(code)) codes.push(code);
  };
  if (!data) return codes;
  add(data.ErrorCode);
  const messages = Array.isArray(data.Messages) ? data.Messages.slice(0, 5) : [];
  for (const m of messages) {
    const errors = Array.isArray(m?.Errors) ? m.Errors.slice(0, 10) : [];
    for (const e of errors) add(e?.ErrorCode);
  }
  return codes.slice(0, 5);
}

/** The id of the first message sent: MessageUUID, else MessageID (absent in sandbox mode). */
function messageIdOf(message) {
  const to = Array.isArray(message?.To) ? message.To[0] : undefined;
  const uuid = to?.MessageUUID;
  if (typeof uuid === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(uuid)) return uuid;
  const id = to?.MessageID;
  if (Number.isSafeInteger(id) && id > 0) return String(id);
  if (typeof id === 'string' && /^\d{1,20}$/.test(id)) return id;
  return '';
}

/** Classifies an answer read in full (or throws the matching MailjetError). */
export function classify(status, text, headers = new Headers()) {
  const data = parseJson(text);
  const codes = errorCodes(data);
  const code = codes.join(', ');
  if (status >= 200 && status < 300) {
    const first = Array.isArray(data?.Messages) ? data.Messages[0] : undefined;
    if (first?.Status === 'success') return { messageId: messageIdOf(first) };
    // Accepted by HTTP but not readable as a success: it may have left.
    throw new MailjetError('unconfirmed', { status, code, sent: 'maybe' });
  }
  if (status === 429) {
    throw new MailjetError('throttled', {
      status,
      sent: false,
      retryAfterMs: retryAfterMs(headers.get('retry-after'), headers.get('date')),
    });
  }
  if (status >= 500) {
    throw new MailjetError('unavailable', {
      status,
      code,
      sent: 'maybe',
      retryAfterMs: retryAfterMs(headers.get('retry-after'), headers.get('date')),
    });
  }
  if (status === 401) {
    // Mailjet answers a refused key with an empty body or its own error
    // object; anything else (an HTML page, a cut JSON) is not a refusal.
    const own =
      text.trim() === '' || codes.some((c) => KEY_CODES.has(c)) || data?.StatusCode === 401;
    throw new MailjetError(own ? 'refused' : 'unexpected', { status, code, sent: false });
  }
  if (status === 403) {
    const sender = codes.some((c) => SENDER_CODES.has(c));
    throw new MailjetError(sender ? 'sender' : 'denied', { status, code, sent: false });
  }
  if (status === 400) {
    if (codes.includes('mj-0013')) {
      throw new MailjetError('address_invalid', { status, code, sent: false });
    }
    throw new MailjetError('invalid', { status, code, sent: false, detail: code || 'HTTP 400' });
  }
  // A redirect (never followed: the keys would go with it), another 4xx.
  throw new MailjetError('unexpected', {
    status,
    code,
    sent: status >= 400 && status < 500 ? false : 'maybe',
  });
}

/**
 * @param {object} options
 * @param {string} options.userAgent
 * @param {string} [options.url] the Send endpoint (a local server in the tests)
 * @param {typeof fetch} [options.fetch]
 */
export function createMailjet({ userAgent, url = API_URL, fetch = globalThis.fetch } = {}) {
  return {
    /**
     * POST the payload; resolves `{ messageId }`, or throws a MailjetError.
     * @param {{ apiKey: string, secretKey: string, body: object, signal: AbortSignal }} request
     */
    async send({ apiKey, secretKey, body, signal }) {
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          redirect: 'manual',
          signal,
          headers: {
            Authorization: `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': userAgent,
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        if (signal?.aborted) throw new MailjetError('timeout', { sent: 'maybe' });
        const errCode = err?.cause?.code ?? err?.code;
        throw new MailjetError('network', {
          sent: NOT_SENT.has(errCode) ? false : 'maybe',
          detail: typeof errCode === 'string' && /^[A-Z_]{2,32}$/.test(errCode) ? errCode : '',
        });
      }
      let text;
      try {
        text = await readBounded(response, MAX_RESPONSE_BYTES);
      } catch (err) {
        if (err instanceof MailjetError) {
          // Too large: a success is never read from it, it may have left.
          if (response.status >= 200 && response.status < 300) {
            throw new MailjetError('unconfirmed', { status: response.status, sent: 'maybe' });
          }
          throw err;
        }
        // Cut while reading: an answer we cannot read.
        if (signal?.aborted) throw new MailjetError('timeout', { sent: 'maybe' });
        throw new MailjetError(response.status < 300 ? 'unconfirmed' : 'network', {
          status: response.status,
          sent: 'maybe',
        });
      }
      return classify(response.status, text, response.headers);
    },
  };
}
