---
"@openokr/web": patch
---

On a cloud with seat limits, a personal invitation now holds a seat from the moment it is sent, as the plan screen always said. Before, only people who had joined were counted, so while seats were free an administrator could invite any number of people, and each one past the limit was refused when they clicked the link. Now the invitation past the limit is refused instead, naming both numbers. An invitation releases its seat when it is accepted, revoked or expires. Asking the same person twice holds one seat, and the plan screen lists each pending invitation among the seat holders. A move to a smaller plan is still judged by the people already in the workspace.
