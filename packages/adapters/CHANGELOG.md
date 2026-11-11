# @openokr/adapters

## 0.8.1

### Patch Changes

- [#210](https://github.com/open-okr/open-okr/pull/210) [`b30346d`](https://github.com/open-okr/open-okr/commit/b30346db74bdc5cd87d6d920224f915ce466023e) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - On OpenRouter, the fast and balanced AI tiers now default to GPT-6 Luna, and the deep tier stays on Claude Sonnet 4.5. Luna costs about a thirtieth of Sonnet 4.5 and, run live, passed every capability's evaluation set and filled every copilot proposal. This changes only a workspace or deployment that never chose a model: a model picked on the AI page, or in `ai.deployment.tierModels`, is kept. The recovery-title assist also gets more room to reply, because a reasoning model spends part of that budget thinking and ran out of it.
- Updated dependencies []:
  - @openokr/config@0.8.1

## 0.8.0

### Minor Changes

- [#204](https://github.com/open-okr/open-okr/pull/204) [`3e37fd0`](https://github.com/open-okr/open-okr/commit/3e37fd0ed8f008a0a3dc992b64ed18ca38d7e6d1) Thanks [@agungksidik](https://github.com/agungksidik)! - A single sign-on domain can be proved with a DNS TXT record. Enforcement can be turned on only for verified domains, a free-mail domain can never be verified, one workspace on an instance owns a verified domain, and a new password sign-up on a verified, enforced domain is refused. Verified domains are checked again every day and lose verification after three failed checks. Connections that already enforce keep enforcing for their members. An instance administrator can mark a domain verified by hand on an instance with no public DNS.

### Patch Changes

- Updated dependencies [[`cdad1fa`](https://github.com/open-okr/open-okr/commit/cdad1fa90e1f045a5907520c99f47de49f2748c9)]:
  - @openokr/config@0.8.0

## 0.7.0

### Patch Changes

- [#192](https://github.com/open-okr/open-okr/pull/192) [`25447b7`](https://github.com/open-okr/open-okr/commit/25447b75e076586eda4b0320689fc747b660fb2e) Thanks [@agungksidik](https://github.com/agungksidik)! - The outbound address guard now recognises every IPv6 form of a private IPv4 address.
- Updated dependencies []:
  - @openokr/config@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.6.0

## 0.5.0

### Patch Changes

- [#171](https://github.com/open-okr/open-okr/pull/171) [`8f202fc`](https://github.com/open-okr/open-okr/commit/8f202fcdb168a9d05ac4b46812218c1f7e22350e) Thanks [@dependabot](https://github.com/apps/dependabot)! - The Anthropic provider moves to version 1 of Anthropic's SDK, which uses API version 2026-10-21 and sends the API key as a bearer token. That API version refuses a temperature on every model, so requests to Anthropic models no longer carry one, and the sampling a workspace sets for a tier does not apply to them. Nothing set a temperature on a request before this change, so no request behaves differently. A proxy in front of Anthropic that reads the `X-Api-Key` header now has to read `Authorization` instead.
- Updated dependencies []:
  - @openokr/config@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.4.0

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
