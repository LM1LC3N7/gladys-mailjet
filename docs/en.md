# Mailjet for Gladys

Unofficial integration, not affiliated with Mailjet. It **sends** e-mails through your Mailjet account with
the Send API v3.1; it never reads any. This integration has never been tested with a real Mailjet account:
it was built from the official Mailjet documentation and tested against local fake servers. Reports are
welcome.

## What leaves, and when

An e-mail leaves only on one of these three paths:

1. **The “Send an e-mail with Mailjet” scene action**: one plain-text e-mail to one address, with an
   optional subject (the configured subject otherwise). Its output `message_id` is the Mailjet id of the
   e-mail.
2. **A Gladys message, only if the option “Also send the Gladys messages” is on (off by default)**, to a
   user who entered their address in the **My account** block. Gladys relays to this channel, among
   others: the core “Send a message” scene action, the system messages to administrators (upgrade, backup
   failure, low batteries, Gladys Plus, weekly digest) and the **link or code of a forgotten password**.
   The integration receives only an address and a text: it cannot tell a message aimed at this channel
   from one sent to all channels, so the option covers them all, also when Mailjet is the chosen system
   message channel. Each one counts in the hourly limit and in your Mailjet plan. With the option off,
   these messages are refused and nothing leaves; the refusal shows **only in the Gladys logs** (not in
   the scene nor in the chat). The camera image of the “Send a camera image” action is attached (JPEG, PNG
   or WebP, 2 MB at most).
3. **The Test button**, in Mailjet **sandbox mode**: Mailjet checks the keys and the test message and
   delivers nothing. Whether Mailjet also checks the sender in sandbox mode is not confirmed: the first
   real e-mail tells. The button calls Mailjet at each click, outside the hourly limit (bounded by the 2
   requests at once and the pause). It relies on the `SandboxMode` flag of the Send API, never checked on a
   real account yet: if Mailjet ignored it, the test e-mail would really be delivered.

Nothing is sent at start-up or on a schedule.

## Setting up

1. In Mailjet, **Account settings → REST API → API key management**: copy the API key and the secret key.
2. **Senders & Domains**: validate the sender address (or its whole domain). Without it, Mailjet refuses
   every e-mail (“not the sender address”).
3. In Gladys, fill in the keys, the sender address, optionally the sender name, the subject of the Gladys
   messages, the hourly limit and the option “Also send the Gladys messages”; save, then click **Test**.
4. If the option is on, each user enters their address in **My account** (clear it to stop).

The secret key is kept by Gladys in its database, never shown again, and sent only to Mailjet.

## What protects your account and your plan

- **Hourly limit** (20 by default, 1 to 200): at most this many e-mails over any 60 minutes, Gladys
  messages and scene actions together. Beyond it nothing is sent and the action fails with the time of
  the next possible e-mail. The count is kept in `/data` across restarts. An e-mail is counted before it
  leaves. It is given back only when nothing left: Mailjet answered a 4xx (400, 401, 403, 429), or the
  connection never opened (connection refused, unknown name, network unreachable). No answer, a cut
  connection, a 5xx or an unreadable answer keep it counted.
- **Never sent twice**: no e-mail is sent again by the integration, whatever happened (no answer, a cut
  connection, a server error). When Mailjet did not confirm, the action fails with “it may have been sent,
  so it is not sent again”.
- **Gladys messages**: Gladys waits 5 seconds for an answer. When Mailjet is slower, the integration
  answers after 3.5 seconds “no answer yet” and lets the request finish (20 seconds at most); the status
  then says how it went. An e-mail still waiting for its turn at that moment is given up and never sent.
- **At most 2 e-mails at once**, 10 waiting; beyond, “too many e-mails at once” and nothing is sent.
- **Slow down**: after a 429 (too many requests) or a Mailjet server error (5xx, even with an unreadable
  body), nothing is sent for 60 seconds, doubled at each new failure up to 1 hour (a `Retry-After` of
  Mailjet is followed up to 6 hours), Test included. The pause is kept in `/data`; an e-mail accepted while
  it began does not lift it.
- **Refused keys**: only a 401 carrying a Mailjet key error code (`mj-0001` suspended key, `mj-0015` wrong
  credentials). Then nothing more is sent with these keys until they change or the Test button succeeds
  (the Test button tries refused keys too, outside a pause). Only 8 bits of a salted fingerprint are kept
  in `/data`, never a key. Not a refusal of the keys: a 401 without such a code (empty, a proxy page, a cut
  answer), a 403 (sender not validated, sending denied), a refused address or e-mail (400). A 401 without
  code and a 403 are not tried again at each e-mail either: they set the same pause as a 429 (60 seconds
  doubled up to 1 hour, kept in `/data`, Test included); nothing is kept about the keys.

## Status

| Status                                                              | Meaning                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Ready                                                               | Keys and sender filled in; checked by Mailjet at the first e-mail or the Test button. |
| Mailjet accepted the last e-mail                                    | With the count of the last hour and the limit.                                        |
| Mailjet accepted the keys and the test message                      | The last Test succeeded (nothing delivered).                                          |
| Refused keys / sender not validated / paused / hourly limit reached | Nothing is sent; the text says until when or what to change.                          |
| Hourly counter not saved                                            | `/data` is unread, read-only or slow: the limit holds until the next restart only.    |

## Privacy

The logs show addresses masked (`j***@e***.com`); the keys, subjects and texts are never logged, put in the
status or written to `/data`. `/data/mailjet.json` holds the times of the e-mails of the last hour, the pause
and the fingerprint of refused keys.

## Limits

- Plain text only (the Markdown of Gladys messages is sent as is); one recipient per scene action.
- E-mails are not received: this is a send-only channel.
- Mailjet sending quotas of your plan apply on top of the hourly limit.
