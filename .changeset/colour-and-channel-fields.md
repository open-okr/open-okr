---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/core": patch
"@openokr/formats": patch
---

The brand colour can be picked, and each channel's form names its own fields.

Branding has a colour picker beside the hex box, and a colour that reads as
red, amber or green is refused as it is picked rather than after Save. Reset
to defaults works whatever the box holds.

Each channel's connect form now asks for what its provider calls things:
Slack's Bot User OAuth Token, Signing Secret and Workspace ID; Teams'
Application (client) ID, client secret and Directory (tenant) ID; WhatsApp's
access token, app secret, verify token and phone number ID; Telegram's bot
token, webhook secret and bot ID. Ids are shown as typed, Teams' App ID
included, which was masked. WhatsApp's verify token has its own box: it was
typed after the app secret in one box, split on a space. The hints are
translated.
