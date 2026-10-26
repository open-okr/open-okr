---
"@openokr/web": minor
"@openokr/ui": minor
---

A member can connect their own AI agent by pasting one prompt.

The Work Map shows a pill that copies a setup prompt for Claude Code, Hermes
Agent, ChatGPT in developer mode and Gemini CLI. The prompt names this
instance's agent endpoint and signs in with OAuth, so it carries no token and
the member approves the connection in the browser. Closing the pill hides it
until the next sign-in.

The API tokens screen copies the same prompt, and the answer that mints an
agent token copies a version with that token in it. ChatGPT accepts OAuth only,
and the token version says so.

The Gemini CLI steps follow its documentation and were not checked against a
live client.
