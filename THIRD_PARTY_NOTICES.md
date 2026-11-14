# Third-party notices

## Gladys integration SDK

`@gladysassistant/integration-sdk` (Apache-2.0) is installed from npm and
shipped in the Docker image under `node_modules/` with its own license file.
No code of it is copied into this repository.

## Mailjet

"Mailjet" is a trademark of Mailjet SAS (Sinch), used only to name the service
this integration talks to. The integration calls the public Mailjet Send API
v3.1 with plain `fetch`, written from the official documentation
(https://dev.mailjet.com/docs/email-api/send-api-v31/, read on 2026-11-14): no
Mailjet library and no code of theirs is used or copied.
