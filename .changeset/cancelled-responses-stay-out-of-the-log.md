---
"openokr": patch
---

The server log no longer fills up with "The destination stream closed early".

That error means a browser stopped reading a page before the server finished
drawing it. Almost always it is the page's own prefetching, which reads a
screen up to its loading state and cancels the rest, so nothing had failed.
One test run logged more than a thousand of them, and real errors were lost
among them. They are now left out of the log. Set `LOG_LEVEL=debug` to see
them again, for example while checking whether a proxy is cutting responses
off. Every other error is logged exactly as before.
