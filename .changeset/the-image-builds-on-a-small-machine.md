---
"openokr": patch
---

The Docker image builds on a machine with 8 GB of memory or less.

`docker build` ran out of memory during Next's own type check on a default
Docker Desktop, and would have on the 4 GB server the install guide
recommends, which since the guide changed is also where self-hosters build
the image. The image build now skips that step. The same type check still
stands in front of every image: continuous integration runs it on every change
and on every release tag before an image is built.
