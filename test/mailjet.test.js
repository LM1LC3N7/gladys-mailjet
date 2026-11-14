// -----------------------------------------------------------------------------
// The Mailjet client against a real local HTTP server (127.0.0.1): the
// request it writes, and how each answer of the Send API documentation is
// read. Never the network.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createMailjet, errorCodes, retryAfterMs } from '../src/mailjet.js';

const API_KEY = '0123456789abcdef0123456789abcdef';
const SECRET = 'fedcba9876543210fedcba9876543210';
const BODY = { Messages: [{ From: { Email: 'a@example.com' }, To: [{ Email: 'b@example.com' }] }] };

/** A local server: `handler(req, res, body)`; `requests` keeps what came in. */
async function server(t, handler) {
  const requests = [];
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections();
    return new Promise((resolve) => srv.close(resolve));
  });
  const url = `http://127.0.0.1:${srv.address().port}/v3.1/send`;
  return { url, requests, srv };
}

const reply =
  (status, body = '', headers = {}) =>
  (req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

async function send(t, handler, { timeout = 5000 } = {}) {
  const srv = await server(t, handler);
  const client = createMailjet({ userAgent: 'gladys-mailjet/test', url: srv.url });
  try {
    const result = await client.send({
      apiKey: API_KEY,
      secretKey: SECRET,
      body: BODY,
      signal: AbortSignal.timeout(timeout),
    });
    return { result, srv };
  } catch (error) {
    return { error, srv };
  }
}

test('the request: POST JSON, Basic keys, User-Agent; the success read', async (t) => {
  const { result, srv } = await send(
    t,
    reply(200, {
      Messages: [
        {
          Status: 'success',
          To: [{ Email: 'b@example.com', MessageUUID: 'abc-123', MessageID: 576460752303423500 }],
        },
      ],
    }),
  );
  assert.deepEqual(result, { messageId: 'abc-123' });
  const [req] = srv.requests;
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/v3.1/send');
  assert.equal(
    req.headers.authorization,
    `Basic ${Buffer.from(`${API_KEY}:${SECRET}`).toString('base64')}`,
  );
  assert.equal(req.headers['content-type'], 'application/json');
  assert.equal(req.headers.accept, 'application/json');
  assert.equal(req.headers['user-agent'], 'gladys-mailjet/test');
  assert.deepEqual(JSON.parse(req.body), BODY);
});

test('a sandbox success has no id; a MessageID alone is taken', async (t) => {
  const sandbox = await send(t, reply(200, { Messages: [{ Status: 'success', To: [{}] }] }));
  assert.deepEqual(sandbox.result, { messageId: '' });
  const legacy = await send(
    t,
    reply(200, { Messages: [{ Status: 'success', To: [{ MessageID: 1234 }] }] }),
  );
  assert.deepEqual(legacy.result, { messageId: '1234' });
});

test('401: a refusal of the keys only when the answer is Mailjet’s', async (t) => {
  for (const [body, kind] of [
    ['', 'refused'],
    [{ ErrorCode: 'mj-0015', StatusCode: 401, ErrorMessage: 'x' }, 'refused'],
    [{ ErrorCode: 'mj-0001', StatusCode: 401 }, 'refused'],
    ['<html>Proxy authentication</html>', 'unexpected'],
    ['{"ErrorCode":"mj-00', 'unexpected'],
  ]) {
    const { error } = await send(t, reply(401, body));
    assert.equal(error.kind, kind, JSON.stringify(body));
    assert.equal(error.sent, false);
  }
});

test('403, 400: the sender, a denial, a bad address, a refused e-mail; nothing sent', async (t) => {
  const perMessage = (code, status) => ({
    Messages: [{ Status: 'error', Errors: [{ ErrorCode: code, StatusCode: status }] }],
  });
  for (const [status, body, kind, code] of [
    [403, perMessage('send-0008', 403), 'sender', 'send-0008'],
    [403, perMessage('send-0099', 403), 'denied', 'send-0099'],
    [403, '', 'denied', ''],
    [400, perMessage('mj-0013', 400), 'address_invalid', 'mj-0013'],
    [400, perMessage('mj-0006', 400), 'invalid', 'mj-0006'],
    [400, { ErrorCode: 'mj-0002', StatusCode: 400 }, 'invalid', 'mj-0002'],
  ]) {
    const { error } = await send(t, reply(status, body));
    assert.equal(error.kind, kind);
    assert.equal(error.code, code);
    assert.equal(error.sent, false);
  }
});

test('429 and 5xx: Retry-After in seconds or as a date against the Date of the answer', async (t) => {
  const a = await send(t, reply(429, '', { 'Retry-After': '120' }));
  assert.equal(a.error.kind, 'throttled');
  assert.equal(a.error.retryAfterMs, 120_000);
  const b = await send(
    t,
    reply(503, '', {
      'Retry-After': 'Sat, 14 Nov 2026 10:05:00 GMT',
      Date: 'Sat, 14 Nov 2026 10:00:00 GMT',
    }),
  );
  assert.equal(b.error.kind, 'unavailable');
  assert.equal(b.error.sent, 'maybe');
  assert.equal(b.error.retryAfterMs, 300_000);
  assert.equal(retryAfterMs('Sat, 14 Nov 2026 10:05:00 GMT', undefined), undefined);
  assert.equal(retryAfterMs('soon', 'Sat, 14 Nov 2026 10:00:00 GMT'), undefined);
  assert.equal(retryAfterMs(undefined, undefined), undefined);
});

test('a 200 that is not a readable success, or too large: unconfirmed, it may have left', async (t) => {
  for (const body of [
    'not json',
    '',
    { Messages: [{ Status: 'error' }] },
    { Messages: [] },
    '{"Messages":[{"Status":"succ',
  ]) {
    const { error } = await send(t, reply(200, body));
    assert.equal(error.kind, 'unconfirmed', JSON.stringify(body));
    assert.equal(error.sent, 'maybe');
  }
  const big = await send(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"Messages":[{"Status":"success","x":"');
    const chunk = 'x'.repeat(16 * 1024);
    // Far more than 64 KB, sent without end: the client stops reading.
    let n = 0;
    const timer = setInterval(() => {
      if (n++ > 200 || res.destroyed) return clearInterval(timer);
      res.write(chunk);
    }, 1);
  });
  assert.equal(big.error.kind, 'unconfirmed');
  const bigError = await send(t, reply(500, 'y'.repeat(100 * 1024)));
  assert.equal(bigError.error.kind, 'too_large');
});

test('a redirect is not followed (the keys would go with it)', async (t) => {
  const { error, srv } = await send(
    t,
    reply(302, '', { Location: 'http://127.0.0.1:1/elsewhere' }),
  );
  assert.equal(error.kind, 'unexpected');
  assert.equal(error.status, 302);
  assert.equal(srv.requests.length, 1);
});

test('no answer: a timeout, it may have left; a refused connection: nothing left', async (t) => {
  const { error } = await send(t, () => {}, { timeout: 300 });
  assert.equal(error.kind, 'timeout');
  assert.equal(error.sent, 'maybe');
  const closed = await server(t, () => {});
  const url = closed.url;
  closed.srv.closeAllConnections();
  await new Promise((resolve) => closed.srv.close(resolve));
  const client = createMailjet({ userAgent: 'x', url });
  const refused = await client
    .send({ apiKey: API_KEY, secretKey: SECRET, body: BODY, signal: AbortSignal.timeout(3000) })
    .catch((e) => e);
  assert.equal(refused.kind, 'network');
  assert.equal(refused.sent, false);
  assert.equal(refused.detail, 'ECONNREFUSED');
  // Cut in the middle of the answer.
  const cut = await send(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '500' });
    res.write('{"Messages":');
    setTimeout(() => res.destroy(), 20);
  });
  assert.equal(cut.error.kind, 'unconfirmed');
  assert.equal(cut.error.sent, 'maybe');
});

test('error codes: well-formed ones only, bounded', () => {
  assert.deepEqual(errorCodes(null), []);
  assert.deepEqual(
    errorCodes({
      ErrorCode: 'mj-0002',
      Messages: [{ Errors: [{ ErrorCode: 'send-0008' }, { ErrorCode: '<b>x</b>' }] }],
    }),
    ['mj-0002', 'send-0008'],
  );
  const many = {
    Messages: [{ Errors: Array.from({ length: 50 }, (_, i) => ({ ErrorCode: `mj-${1000 + i}` })) }],
  };
  assert.equal(errorCodes(many).length, 5);
});
