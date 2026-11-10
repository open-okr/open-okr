---

---

The Google AI driver moves to `@google/genai` 3.0 and names the Gemini API version it calls, `v1beta`, which is the one 2.x used by default. SDK 3.0 would otherwise switch to `v1` and let an environment variable choose. Every request goes where it went before, so a running instance cannot tell.
