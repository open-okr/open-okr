# @openokr/adapters

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.3.1

## 0.3.0

### Patch Changes

- [#121](https://github.com/open-okr/open-okr/pull/121) [`9229546`](https://github.com/open-okr/open-okr/commit/9229546ea329e52152c9bc18ddc3072ca22b026a) Thanks [@agungksidik](https://github.com/agungksidik)! - A mail relay without TLS can be used when somebody chooses to.
  
  The instance always required STARTTLS, so a local relay such as Mailpit,
  which the staging guide recommended, failed every send. A new instance
  setting, `mail.requireTls` (`OPENOKR_MAIL_REQUIRE_TLS`), turns that off. It
  stays on by default, and the staging guide says when not to turn it off.

- [#123](https://github.com/open-okr/open-okr/pull/123) [`e00d918`](https://github.com/open-okr/open-okr/commit/e00d9185b2fda42956f56911e019724816e430a9) Thanks [@agungksidik](https://github.com/agungksidik)! - Agents built on the current MCP SDK can connect and read the tool list.
  
  The handshake echoed a protocol version the endpoint then refused on the
  next request, so a client asking for 2025-11-25 failed right after
  connecting; it is now answered with 2025-06-18. One tool's input schema had
  no object type at the top, which made the whole tool list unreadable to the
  official client. `resources/list` answers with an empty list instead of
  "method not found".

- [#124](https://github.com/open-okr/open-okr/pull/124) [`cb18797`](https://github.com/open-okr/open-okr/commit/cb18797ad48ff0715a051e57821f51e38ea186a3) Thanks [@agungksidik](https://github.com/agungksidik)! - An agent can open the four prompts the MCP endpoint lists (weekly check-in,
  review against the quality checks, prepare my review, what do I owe). The
  endpoint listed them but answered "method not found" when a client asked for
  one; each now answers with its starting question and the tools that answer it.

- [#123](https://github.com/open-okr/open-okr/pull/123) [`ca715ae`](https://github.com/open-okr/open-okr/commit/ca715aee40d0595062eb1f87afe8f0d77ba8f11c) Thanks [@agungksidik](https://github.com/agungksidik)! - The invitation, the notification digest and every agent nudge sent by email
  now arrive in the product's mail layout, beside the plain text, in the
  workspace's name, colour and language (English or Malay).
  
  The invitation names the workspace and who sent it, and when it expires. The
  digest says who did what, with a chip for why it reached you, and its "and N
  more" line is now in the HTML part as well as the text. A nudge shows the
  agent that sent it, the action as a button, and the rule it follows; the
  daily summary lists its rows. Every link opens a page the instance serves.
- Updated dependencies []:
  - @openokr/config@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.0
