# TODO

## Before announcing

- [ ] Test on a real Gladys 5.1+ with a real Mailjet account: the Test
      button (sandbox), a "Send a message" scene action to a user with an
      address in "My account", a "Send a camera image" action, the "Send an
      e-mail with Mailjet" scene action and its `message_id` output, a
      sender not validated, wrong keys.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).
- [ ] Store fields left out of the manifest on purpose (Louis' rule):
      keywords `Mailjet`, `e-mail`, `email`, `notification`, `courriel`; no
      `countries` (Mailjet sends worldwide).

## To confirm on a real account (built without one)

- [ ] The sandbox mode checks the sender (`send-0008` expected for a sender
      not validated) and the keys (401) like a real send: the documentation
      says "the full range of error messages".
- [ ] The body of a 401 for wrong keys: only the `mj-0015` / `mj-0001` object
      is taken as a refusal; any other 401 (an empty body included) only sets
      the pause of a 429 (60 s doubled up to 1 h, kept in /data), so wrong keys
      are tried again at most once per pause; if Mailjet answers an empty
      body, the code should accept it as a refusal.
- [ ] `SandboxMode` really honored (the Test button would deliver a real
      e-mail, outside the hourly limit, if Mailjet ignored it).
- [ ] The `Retry-After` header on a 429 (the documentation does not say it is
      sent; without it, the pause is 60 s doubled).
- [ ] The "My account" block shows the `email` field to every user, and an
      empty value skips the user (core: `getContactProfile` empty).

## Later

- Several recipients per scene action (one message each, so they do not see
  each other), Cc/Bcc.
- An HTML part rendered from the Markdown of Gladys messages.
- Mailjet templates (`TemplateID` and `Variables`).

## Decisions

- **0.1.0 set by hand** in package.json, package-lock.json and the manifest
  (`docker_image` `ghcr.io/lm1lc3n7/gladys-mailjet:0.1.0`); the Release
  workflow takes over afterwards.
- **Type `communication`, `messaging.receive: false`** (send-only family of
  the SDK README, like Free Mobile or CallMeBot) plus a scene action for any
  address; no reception. `gladys_version: ">=5.1.0"` (scene actions and the
  external communication type). No `countries`.
- **Gladys messages behind `forward_gladys_messages`, off by default**
  (coordinator, review r1, like gladys-threema): the core relays to this
  channel the "Send a message" scene action, the system messages (to all
  channels unless the admin picked one) and the forgotten password link or
  code (`POST /forgot_password`, no channel chosen). The WebSocket command
  carries only the contact and the text: a targeted message cannot be told
  from a broadcast, so the option covers everything that reaches
  `onSendMessage`, checked first (before address, text, count, request).
  Off: `forward_off` thrown; the core catches it in `forwardToChannels`, so
  the refusal shows only in the core logs (said in the docs).
- **No library**: plain `fetch` to `https://api.mailjet.com/v3.1/send`
  (Basic auth), redirects not followed (the keys would go with them), answer
  read within 64 KB and 20 s.
- **Never sent twice**: no retry anywhere. Counted before leaving; given back
  only when Mailjet answered a 4xx (not sent) or the connection never opened
  (ECONNREFUSED, DNS). A timeout, a cut answer, a 200 that is not a readable
  success or a 5xx stay counted and fail with "it may have been sent".
- **Hourly limit**: a sliding 60 minutes on the monotonic clock, 20 by default
  (1 to 200), Gladys messages and scene actions together, the sandbox Test
  excluded; the times kept in `/data` as wall times (a future time is
  invalid) and restored at start.
- **Gladys messages**: the core waits 5 s for the ack (COMMAND_TIMEOUT_MS):
  the ack is given at 3.5 s at most; a request already gone goes on in the
  background (20 s) and its outcome lands in the status; an e-mail still
  waiting for a slot is given up, never sent later. Configuration and /data
  are awaited 1 s at most on that path.
- **Refusal of the keys**: only a 401 carrying `mj-0001` or `mj-0015`
  (review r1); an empty 401, a 403 (`send-0006/7/8` sender, other denial),
  a 400, a proxy page or a cut answer are not (kind `unauthorized`, nothing
  kept; a 401 without code and a 403 set the pause of a 429, review r2).
- **A pause is not lifted by a success that left before it** (review r1): a
  pause generation copied when a request leaves, compared on its success.
- **429/5xx known from the status line**: a body too large or cut still
  pauses (review r1).
- **A 401 without a Mailjet key code and any 403 pause** like a 429
  (coordinator, review r2): given back to the hourly count (nothing left),
  so without the pause a looping scene would hammer Mailjet with possibly
  wrong keys; no refusal is kept. Kept as 8 bits of an HMAC-SHA-256
  under a random salt in `/data` (full hash in memory only); after a
  restart, other keys collide with probability 1/256, and the Test button,
  which always sends, clears it.
- **Pause**: 60 s doubled up to 1 h, `Retry-After` (seconds, or a date
  compared to the `Date` of the answer) up to 6 h; on every path, Test
  included; kept in `/data`.
- **/data never blocks a send** (same rule as gladys-amazon-polly): the count
  is checked in memory; the write is awaited 1 s at most; unread, read-only
  or slow `/data` is said in the status ("limit only until the next
  restart").
- **The API key is a `string` field** (the public half, like an AWS access
  key id), the secret key a `secret`; both never logged.
- **Addresses** checked locally (no space, control, quote, IP literal; a
  dotted domain); masked in the logs as `j***@e***.com`; the Test result
  shows the sender masked too. Subjects lose their line breaks (no header
  injection) and are cut at 200 characters; bodies at 20,000.
