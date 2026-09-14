---
"openokr": minor
---

The groundwork for a managed cloud, with nothing visible on a self-hosted
instance.

A new `tenants` table records what a vendor knows about a customer it
operates the product for: a plan, a seat count, a trial end, a region and a
lifecycle state. It is written by workspace provisioning, in the same
transaction as the workspace itself, and only when the instance has been told
it is a cloud one.

**Three new instance settings, all defaulting to the self-hosted answer.**
`cloud.enabled` is off, so an instance that is never told otherwise writes no
tenant row and behaves exactly as it did before. `cloud.region` is recorded on
every tenant and never routed on. `cloud.closureRetentionDays` is zero, which
means a closed workspace is never erased: a number out of the box would
delete data on every instance that never chose one.

**Nothing on the product path may read the tenant row**, and the architecture
boundary gate now refuses one that tries. A plan key read by a goal list or a
check-in would fork the self-hosted product from the cloud one, and the fork
would stay invisible until a self-hosted instance met the null.

Self-hosted behaviour is unchanged in every respect. No screen, no setting to
answer, no seat limit and no billing surface.
