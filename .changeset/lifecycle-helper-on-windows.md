---
"openokr": patch
---

The lifecycle helper works from Git Bash on Windows.

`./openokr rotate-key` failed on a module that was never missing when it was
run from Git Bash with Docker Desktop. That shell rewrites an argument shaped
like an absolute path before handing it to a native program, so the path to the
rotation script inside the container arrived with the shell's own install
directory spliced into it. The same rewrite reached the restore path and both
blob copies.

Nothing about a Linux host changes: the two variables that switch the rewrite
off are read by that one shell and ignored everywhere else.

`deploy/docker/secrets/` and `deploy/docker/backups/` are ignored by git now.
Running the documented backup command from inside a checkout used to leave an
encrypted database dump, and an interrupted run used to leave the instance root
key, sitting untracked where git offers to commit them.
