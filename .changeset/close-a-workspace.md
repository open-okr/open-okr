---
"@openokr/web": minor
---

On a cloud, a workspace's owner can now close it on Admin, General by typing its address, after being shown the date it will be deleted, where to export it, and that the subscription will not renew and nothing is refunded. Closing asks Stripe to stop renewing the subscription at the period's end, and emails every owner and administrator who closed it, when it will be deleted and how to undo it. An owner who closed an active workspace can reopen it until then. A closed workspace's banner gives both dates, and the operator console shows when each closed workspace will be deleted.
