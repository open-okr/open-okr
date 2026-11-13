---
"@openokr/web": minor
---

A new instance now needs a setup code before its first account can be created. `./openokr up` generates the code, writes it to `secrets/app.env` and prints it. The Helm chart generates it into its Secret and the install notes say how to read it. With no `OPENOKR_SETUP_CODE`, the server makes a code at first boot and keeps it in `<storage root>/setup-code`, and the setup wizard names that file. The wizard asks for the code on the account step. An instance that is already claimed is unaffected and the code is never asked for again. Scripts that claim an instance send it in the `x-openokr-setup-code` header of the sign-up request. Adds `OPENOKR_SETUP_CODE` (optional) and the internal setting `setup.codeHash`. No migration.
