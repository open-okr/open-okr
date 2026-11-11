---
"@openokr/web": patch
---

The Docker image build leaves out every `.env` file in the source tree, not only the one at the root, so a developer's nested env file can no longer be copied into the build stage with the real values it holds.
