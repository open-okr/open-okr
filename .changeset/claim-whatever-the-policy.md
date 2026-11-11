---
"@openokr/web": patch
---

An instance deployed with `OPENOKR_REGISTRATION=invite_only`, or with `company_domains` and a free mail address in the setup wizard, can now be claimed. The setup wizard's sign-up was refused by the policy it was about to put in force, so nobody could ever finish setup. An unclaimed instance, setup unfinished and no account, now admits its first account whatever the policy says, created verified as before, and the policy governs every account after it. The wizard shows a refused sign-up as the refusal and never as a failed sign-in.
