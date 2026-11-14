# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** of type `communication`
(send-only channel, `messaging.receive: false`, Gladys 5.1.0+): a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the **Mailjet Send API v3.1** with plain `fetch` and the user's own
keys. E-mails leave on three paths only: the `send_email` scene action, a
Gladys message (`onSendMessage`, the address of the user's "My account"
block) ONLY when `forward_gladys_messages` is on (off by default: the core
relays broadcasts too, system messages and forgotten password links, and the
integration cannot tell them from a targeted message; off, `forward_off` is
thrown first and only shows in the core logs), and the `test_connection`
button (sandbox mode, nothing delivered).
Unofficial: not affiliated with Mailjet.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "limit"   # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run mutants                           # mutation check (scripts/mutants.json), use memcap
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: MailjetApp, FileStore, createMailjet
src/app.js                        MailjetApp: handlers, configuration, hourly limit, queue,
                                  pause, refusal, status, Test button, message ack at 3.5 s
src/mailjet.js                    the only network access: one POST, bounded read, classification
src/config.js                     the form, checked (never throws, never shows a bad value);
                                  address checks and masking
src/store.js                      /data/mailjet.json (send times of the last hour, pause, refusal)
src/constants.js                  endpoint, bounds, delays, manifest keys
src/i18n.js                       runtime texts (en/fr)
gladys-assistant-integration.json manifest: type communication, contact_schema, Test, scene action
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test: fake Gladys, scripted Mailjet, virtual clock;
                                  test/mailjet.test.js: the client on a local HTTP server
scripts/                          cover.png generator, mutation runner and list
```

## Rules

- **Never sent twice.** No retry, in the client or the app. An e-mail is
  counted in the hourly limit BEFORE it leaves, given back only when Mailjet
  answered a 4xx or the connection never opened.
- **Nothing leaves without a person**: a Gladys message, a scene action or the
  Test button (sandbox). No call at start-up, on a schedule or on a
  reconnection.
- **Never a key, a full address, a subject or a text** in a log, the status,
  an error, `/data` or a test fixture (the test keys are made up). Addresses
  go through `maskEmail`.
- **Only a 401 with `mj-0001`/`mj-0015` is a refusal of the keys**; an empty
  401, a 403, a 400, a proxy page or a cut answer are not. A refused key is never sent again by itself;
  new keys are always tried; the Test button always tries.
- **Throttling or 5xx**: a pause on the monotonic clock (60 s doubled up to
  1 h, Retry-After up to 6 h), its wall end in `/data`; the wall clock serves
  only `/data` and the times shown.
- **Gladys waits 5 s for a message ack**: answer by 3.5 s, let a request that
  left finish in the background, give up one that did not leave.
- **/data unreadable is not empty**: read again every 10 s, one read at a time,
  never written before it was read; never blocks a send.
- **Config keys, the action key and the scene action key are forever**
  (`api_key`, `secret_key`, `sender_email`, `sender_name`, `default_subject`,
  `hourly_limit`, `forward_gladys_messages`, contact `email`, `test_connection`, `send_email` and its
  fields `to`, `subject`, `text`, output `message_id`).
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`.
  The catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code: change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (the client tests talk to a local
  server on 127.0.0.1).
