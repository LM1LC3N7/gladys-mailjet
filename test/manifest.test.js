// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. No version is
// pinned: only its shape and its agreement across files.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DEFAULTS, readConfig } from '../src/config.js';
import { ACTIONS, MAX_HOURLY_LIMIT, MIN_HOURLY_LIMIT, SCENE_ACTIONS } from '../src/constants.js';
import { ALL_TEXTS } from '../src/i18n.js';

const CORE = '/home/claude/code/Gladys/server';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const field = (key) => manifest.config_schema.find((f) => f.key === key);
const KEYS = { api_key: 'a'.repeat(32), secret_key: 'b'.repeat(32), sender_email: 'x@example.com' };

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) yield* texts(entry, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

test('the store basics, the version agreeing everywhere, never pinned', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'communication');
  assert.deepEqual(manifest.messaging, { receive: false });
  // Scene actions and the communication type: Gladys 5.1.0.
  assert.equal(manifest.gladys_version, '>=5.1.0');
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.name, 'gladys-mailjet');
  assert.equal(lock.name, pkg.name);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-mailjet:${manifest.version}`);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/LM1LC3N7\/gladys-mailjet\//,
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['notifications']);
  assert.equal(manifest.keywords, undefined);
  // Mailjet sends worldwide: no countries.
  assert.equal(manifest.countries, undefined);
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300);
    assert.match(
      docs,
      /never been tested with a real Mailjet account|jamais été testée avec un vrai compte Mailjet/,
    );
  }
});

test('the manifest passes the schema of the core (when the clone is here)', (t) => {
  const schemaPath = `${CORE}/lib/external-integration/manifest.schema.json`;
  if (!existsSync(schemaPath) || !existsSync(`${CORE}/node_modules/ajv`)) {
    t.skip('Gladys core clone absent');
    return;
  }
  const require = createRequire(`${CORE}/index.js`);
  const Ajv = require('ajv');
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
  assert.ok(validate(manifest), JSON.stringify(validate.errors));
});

test('every text is in English and French; sections within their limits', () => {
  for (const [path, entry] of texts(manifest)) {
    for (const lang of ['en', 'fr']) assert.ok(entry[lang]?.trim(), `${path} needs ${lang}`);
  }
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const lang of ['en', 'fr'])
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang}`);
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
});

test('no key starts with gladys_; the secret has no default; nothing said encrypted', () => {
  const all = [
    ...manifest.config_schema,
    ...manifest.contact_schema,
    ...manifest.actions.flatMap((a) => a.fields ?? []),
    ...manifest.scene_actions.flatMap((a) => a.fields ?? []),
  ];
  for (const f of all) assert.doesNotMatch(f.key, /^gladys_/);
  const secrets = manifest.config_schema.filter((f) => f.type === 'secret');
  assert.deepEqual(
    secrets.map((f) => f.key),
    ['secret_key'],
  );
  for (const f of secrets) {
    assert.equal(f.default, undefined);
    assert.match(
      f.description.en,
      /Kept by Gladys in its database, never shown again, sent only to Mailjet/,
    );
    assert.match(
      f.description.fr,
      /Gardée par Gladys dans sa base, jamais réaffichée, envoyée seulement à Mailjet/,
    );
  }
  assert.equal(field('api_key').default, undefined);
  assert.equal(field('sender_email').default, undefined);
  for (const file of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'CLAUDE.md',
    'src/i18n.js',
  ]) {
    assert.doesNotMatch(read(file), /chiffr(é|ement)|encrypt|hachage/i, file);
  }
});

test('the config fields are the ones the code reads, with the same defaults and bounds', () => {
  assert.deepEqual(
    manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key),
    [
      'api_key',
      'secret_key',
      'sender_email',
      'sender_name',
      'default_subject',
      'hourly_limit',
      'forward_gladys_messages',
    ],
  );
  const config = read('src/config.js');
  for (const f of manifest.config_schema.filter((x) => x.type !== 'section')) {
    assert.ok(config.includes(`config.${f.key}`), f.key);
    if (f.default !== undefined) assert.equal(f.default, DEFAULTS[f.key], f.key);
  }
  const limit = field('hourly_limit');
  assert.equal(limit.min, MIN_HOURLY_LIMIT);
  assert.equal(limit.max, MAX_HOURLY_LIMIT);
  assert.equal(readConfig({ ...KEYS }).hourlyLimit, limit.default);
  assert.ok(readConfig({ ...KEYS, hourly_limit: limit.min }).ok);
  assert.ok(readConfig({ ...KEYS, hourly_limit: limit.max }).ok);
  assert.ok(!readConfig({ ...KEYS, hourly_limit: limit.max + 1 }).ok);
  assert.ok(!readConfig({ ...KEYS, hourly_limit: limit.min - 1 }).ok);
  // The relay of Gladys messages: a boolean, off by default.
  const forward = field('forward_gladys_messages');
  assert.equal(forward.type, 'boolean');
  assert.equal(forward.default, false);
  assert.equal(readConfig({ ...KEYS }).forward, false);
  // The address of each user: the key the code reads.
  assert.deepEqual(
    manifest.contact_schema.map((f) => [f.key, f.type]),
    [['email', 'string']],
  );
  assert.ok(read('src/app.js').includes('contact?.email'));
});

test('every select option follows the rules of the core (none published today)', () => {
  const all = [
    ...manifest.config_schema,
    ...manifest.contact_schema,
    ...manifest.actions.flatMap((a) => a.fields ?? []),
    ...manifest.scene_actions.flatMap((a) => a.fields ?? []),
  ];
  for (const f of all.filter((x) => x.options)) {
    const seen = new Set();
    for (const o of f.options) {
      assert.deepEqual(Object.keys(o).sort(), ['label', 'value'], f.key);
      assert.ok(typeof o.value === 'string' || Number.isInteger(o.value));
      assert.ok(!seen.has(o.value), `${f.key}: ${o.value} twice`);
      seen.add(o.value);
      for (const lang of ['en', 'fr']) {
        const label = o.label[lang];
        assert.equal(typeof label, 'string');
        assert.ok(label.length > 0 && label.trim() === label, `${f.key}.${o.value}.${lang}`);
      }
    }
  }
});

test('the action and the scene action are the ones the code handles; no device, no switch', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key),
    Object.values(SCENE_ACTIONS),
  );
  const app = read('src/app.js');
  assert.ok(app.includes('onAction(ACTIONS.TEST'));
  assert.ok(app.includes('onSceneAction(SCENE_ACTIONS.SEND'));
  assert.ok(app.includes('onSendMessage('));
  for (const a of [...manifest.actions, ...manifest.scene_actions]) {
    assert.ok(a.timeout_seconds >= 5 && a.timeout_seconds <= 120);
  }
  assert.deepEqual(
    manifest.scene_actions[0].fields.map((f) => [f.key, f.required]),
    [
      ['to', true],
      ['subject', false],
      ['text', true],
    ],
  );
  assert.deepEqual(
    manifest.scene_actions[0].outputs.map((o) => o.key),
    ['message_id'],
  );
  // Send only: nothing received, no device, no trigger.
  for (const key of ['widgets', 'scene_triggers', 'energy_contracts', 'webhooks'])
    assert.equal(manifest[key], undefined);
  for (const handler of ['onSetValue', 'publishMessage', 'linkContact', 'onPoll'])
    assert.ok(!app.includes(handler), handler);
});

test('every runtime text exists in both languages', () => {
  for (const [key, entry] of Object.entries(ALL_TEXTS)) {
    assert.deepEqual(Object.keys(entry).sort(), ['en', 'fr'], key);
    for (const lang of ['en', 'fr']) assert.ok(entry[lang].trim(), `${key}.${lang}`);
    const names = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(names(entry.fr), names(entry.en), key);
  }
});
