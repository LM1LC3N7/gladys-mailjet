# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: a send-only e-mail channel through the Mailjet Send API v3.1
  (type `communication`, Gladys 5.1.0+), with the user's own API keys and a
  validated sender.
- A "Send an e-mail with Mailjet" scene action (one address, optional
  subject, outputs the Mailjet message id).
- Gladys messages to the address each user enters in "My account" (camera
  image attached), only with the option "Also send the Gladys messages", off
  by default: it covers every message Gladys relays to the channel (system
  messages, forgotten password link included), and a refusal shows only in
  the Gladys logs.
- Test button in Mailjet sandbox mode: keys and test message checked,
  nothing delivered.
- Guards: an hourly limit (20 by default, 1 to 200) kept in `/data`; never an
  e-mail sent twice; at most 2 e-mails at once; a pause (60 s doubled up to
  1 h, `Retry-After` up to 6 h) after a 429, a server error even with an
  unreadable body, a 401 without a Mailjet key code or a 403, kept across a
  restart and not lifted by a success sent before it; refused keys (a 401
  with a Mailjet key code) never sent again until they change or the Test
  button succeeds.
- Addresses masked in the logs; no key, subject or text logged or kept.
