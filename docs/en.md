# Mailjet for Gladys

Unofficial integration, not affiliated with Mailjet. It **sends** e-mails through your Mailjet account with
the Send API v3.1; it never reads any. This integration has never been tested with a real Mailjet account:
it was built from the official Mailjet documentation and tested against local fake servers. Reports are
welcome.

## What leaves, and when

An e-mail leaves only on one of these three paths:

1. **A Gladys message** to a user who entered their address in the **My account** block of the
   integration: the “Send a message” scene action, and the system messages of Gladys (update done, backup
   failed, low battery…) when the administrator routes them to all channels or to this one (system
   settings). A user who leaves the address empty receives nothing by e-mail. The camera image of the
   “Send a camera image” action is attached (JPEG, PNG or WebP, 2 MB at most).
2. **The “Send an e-mail with Mailjet” scene action**: one plain-text e-mail to one address, with an
   optional subject (the configured subject otherwise). Its output `message_id` is the Mailjet id of the
   e-mail.
3. **The Test button**, in Mailjet **sandbox mode**: Mailjet checks the keys, the sender and the address
   and delivers nothing (not counted in the hourly limit).

Nothing is sent at start-up or on a schedule.

## Setting up

1. In Mailjet, **Account settings → REST API → API key management**: copy the API key and the secret key.
2. **Senders & Domains**: validate the sender address (or its whole domain). Without it, Mailjet refuses
   every e-mail (“not the sender address”).
3. In Gladys, fill in the keys, the sender address, optionally the sender name, the subject of the Gladys
   messages and the hourly limit; save, then click **Test**.
4. Each user enters their address in **My account**.

The secret key is kept by Gladys in its database, never shown again, and sent only to Mailjet.

## What protects your account and your plan

- **Hourly limit** (20 by default, 1 to 200): at most this many e-mails over any 60 minutes, Gladys
  messages and scene actions together. Beyond it nothing is sent and the action fails with the time of
  the next possible e-mail. The count is kept in `/data` across restarts. An e-mail is counted before it
  leaves; it is given back only when Mailjet answered that it refused it (nothing sent).
- **Never sent twice**: no e-mail is sent again by the integration, whatever happened (no answer, a cut
  connection, a server error). When Mailjet did not confirm, the action fails with “it may have been sent,
  so it is not sent again”.
- **Gladys messages**: Gladys waits 5 seconds for an answer. When Mailjet is slower, the integration
  answers after 3.5 seconds “no answer yet” and lets the request finish (20 seconds at most); the status
  then says how it went. An e-mail still waiting for its turn at that moment is given up and never sent.
- **At most 2 e-mails at once**, 10 waiting; beyond, “too many e-mails at once” and nothing is sent.
- **Slow down**: after a 429 (too many requests) or a Mailjet server error, nothing is sent for 60 seconds,
  doubled at each new failure up to 1 hour (a `Retry-After` of Mailjet is followed up to 6 hours), Test
  included. The pause is kept in `/data`.
- **Refused keys** (HTTP 401): nothing more is sent with these keys until they change or the Test button
  succeeds (the Test button tries refused keys too, outside a pause). Only 8 bits of a salted fingerprint are kept in `/data`, never a
  key. A 403 (sender not validated, sending denied) or a refused address is not a refusal of the keys.

## Status

| Status                                                              | Meaning                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Ready                                                               | Keys and sender filled in; checked by Mailjet at the first e-mail or the Test button. |
| Mailjet accepted the last e-mail                                    | With the count of the last hour and the limit.                                        |
| Mailjet accepted the keys and the sender                            | The last Test succeeded (nothing delivered).                                          |
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
