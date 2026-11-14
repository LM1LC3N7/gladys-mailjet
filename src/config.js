// -----------------------------------------------------------------------------
// Configuration: the values of the `config_schema`, checked. `readConfig`
// never throws: it returns `{ ok: true, ... }` or `{ ok: false, reason }`, the
// reason being an i18n key (an invalid value is never shown back).
// Also the address checks and the masking used by the logs.
// -----------------------------------------------------------------------------

import {
  DEFAULT_HOURLY_LIMIT,
  MAX_EMAIL,
  MAX_HOURLY_LIMIT,
  MAX_NAME,
  MAX_SUBJECT,
  MIN_HOURLY_LIMIT,
} from './constants.js';

export const DEFAULTS = {
  sender_name: 'Gladys',
  default_subject: 'Gladys',
  hourly_limit: DEFAULT_HOURLY_LIMIT,
  forward_gladys_messages: false,
};

// A Mailjet API key and secret key: 32 hexadecimal characters today; letters
// and digits only, whatever the length Mailjet moves to.
const KEY = /^[A-Za-z0-9]{16,128}$/;

// An address: a local part without space, control, quote or bracket, and a
// domain of letters, digits and hyphens with at least one dot (no IP literal).
const EMAIL =
  // eslint-disable-next-line no-control-regex -- control characters are what it refuses
  /^[^\s@<>()",;:\\[\]\u0000-\u001f\u007f]{1,64}@(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** The address, trimmed, or null when it is not one. */
export function parseEmail(value) {
  const v = text(value);
  if (!v || v.length > MAX_EMAIL || !EMAIL.test(v)) return null;
  // The last label is a top-level domain: letters only.
  if (!/\.[A-Za-z]{2,63}$/.test(v)) return null;
  return v;
}

/** An address as the logs show it: never complete ("j***@e***.com"). */
export function maskEmail(value) {
  const v = typeof value === 'string' ? value : '';
  const at = v.lastIndexOf('@');
  if (at < 1) return '***';
  const domain = v.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${v[0]}***@${domain[0] ?? ''}***${tld}`;
}

/** One line: controls and line breaks become spaces, at most `max` characters. */
export function oneLine(value, max) {
  return (
    String(value ?? '')
      // eslint-disable-next-line no-control-regex -- control characters are what it removes
      .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
      .trim()
  );
}

/**
 * @param {Record<string, unknown>} raw the values from Gladys
 */
export function readConfig(raw = {}) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const apiKey = text(config.api_key);
  const secretKey = text(config.secret_key);
  if (!apiKey && !secretKey) return { ok: false, reason: 'not_configured' };
  if (!apiKey) return { ok: false, reason: 'api_key_missing' };
  if (!secretKey) return { ok: false, reason: 'secret_missing' };
  if (!KEY.test(apiKey)) return { ok: false, reason: 'api_key_invalid' };
  if (!KEY.test(secretKey)) return { ok: false, reason: 'secret_invalid' };
  if (!text(config.sender_email)) return { ok: false, reason: 'sender_missing' };
  const senderEmail = parseEmail(config.sender_email);
  if (!senderEmail) return { ok: false, reason: 'sender_invalid' };

  const senderName =
    config.sender_name === undefined || config.sender_name === null
      ? DEFAULTS.sender_name
      : oneLine(config.sender_name, MAX_NAME);
  const subject = oneLine(config.default_subject, MAX_SUBJECT) || DEFAULTS.default_subject;

  let limit = DEFAULTS.hourly_limit;
  const rawLimit = config.hourly_limit;
  if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
    // Strict: '' or a decimal is not a number of e-mails.
    const n = typeof rawLimit === 'number' ? rawLimit : Number(text(rawLimit));
    if (
      !Number.isInteger(n) ||
      (typeof rawLimit === 'string' && !/^\d+$/.test(text(rawLimit))) ||
      n < MIN_HOURLY_LIMIT ||
      n > MAX_HOURLY_LIMIT
    ) {
      return { ok: false, reason: 'limit_invalid' };
    }
    limit = n;
  }

  const forward =
    config.forward_gladys_messages === true || config.forward_gladys_messages === 'true';

  return {
    ok: true,
    apiKey,
    secretKey,
    senderEmail,
    senderName,
    subject,
    hourlyLimit: limit,
    // Only true (or the string 'true') turns the relay of Gladys messages on.
    forward,
  };
}
