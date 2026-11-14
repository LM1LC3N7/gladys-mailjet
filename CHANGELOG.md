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
- Gladys messages to the address each user enters in "My account" (camera
  image attached); a "Send an e-mail with Mailjet" scene action (one address,
  optional subject, outputs the Mailjet message id).
- Test button in Mailjet sandbox mode: keys, sender and address checked,
  nothing delivered.
- Guards: an hourly limit (20 by default, 1 to 200) kept in `/data`; never an
  e-mail sent twice; at most 2 e-mails at once; a pause after a 429 or a
  server error (60 s doubled up to 1 h, `Retry-After` up to 6 h) kept across
  a restart; refused keys never sent again until they change or the Test
  button succeeds.
- Addresses masked in the logs; no key, subject or text logged or kept.
