---
"@openokr/web": minor
---

The setup wizard no longer saves a registration policy, so a cloud stays open behind its first account and `OPENOKR_REGISTRATION` keeps working after setup. A cloud operator sets the policy on the console's Instance screen. A cloud set up before 0.7.0 keeps the Invitation only the wizard saved, until the operator chooses again there.
