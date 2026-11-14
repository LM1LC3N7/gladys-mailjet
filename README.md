# Mailjet for Gladys Assistant

Unofficial [Gladys Assistant](https://gladysassistant.com) integration, not
affiliated with Mailjet: a **send-only e-mail channel** (manifest type
`communication`, `messaging.receive: false`) through the
[Mailjet Send API v3.1](https://dev.mailjet.com/docs/email-api/send-api-v31/),
with your own Mailjet account.

- a “Send an e-mail with Mailjet” scene action (one address, plain text);
- only if the option “Also send the Gladys messages” is on (off by default):
  every Gladys message relayed to this channel (“Send a message” scene
  action, system messages, a forgotten password link: the integration cannot
  tell a targeted message from a broadcast) to each user who entered an
  address in “My account”; off, they are refused and the refusal shows only
  in the Gladys logs;
- a Test button in Mailjet sandbox mode (nothing delivered; `SandboxMode` not
  yet checked on a real account);
- an hourly limit kept in `/data`, never an e-mail sent twice, a pause after
  a 429 or a server error, refused keys never sent again by themselves.

Needs Gladys 5.1.0 or later. Never tested with a real Mailjet account yet.

Documentation: [English](docs/en.md) · [Français](docs/fr.md).

## Development

```bash
npm install
npm test            # node --test
npm run lint
npm run format:check
npm run mutants     # mutation check of the guards (scripts/mutants.json), with memcap
npm run cover       # regenerates cover.png
```

Rules for contributors and coding assistants: [CLAUDE.md](CLAUDE.md).
Open points and decisions: [TODO.md](TODO.md).

## Credits and license

Apache-2.0 ([LICENSE](LICENSE)). No third-party code besides the Gladys SDK:
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
