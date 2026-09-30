-- Why a nudge went somewhere other than where it was routed (TECHNICAL-PLAN
-- §4.11, completeness review M-23).
--
-- **A fallback was recorded on the message and not on the nudge.** When the
-- channel a nudge was meant for cannot reach its member, delivery falls back to
-- the member's own channel or to email, and the reason went into the channel
-- message log only. The nudge row is the product's record of what it said and
-- why, and it could answer "suppressed, and why" but not "sent by email, and
-- why". A rule routed to a channel the member never linked is the case that
-- made this matter: it used to be sent there and dropped by the driver.
--
-- Null means it went where it was routed. Words from the router, never a
-- provider's error text or an address.
--
-- Additive and nullable, so the previous release reads the table unchanged and
-- a rolling upgrade has nothing to reconcile. `nudges` already carries its
-- tenant policy from migration 0033, and a new column inherits it.
alter table nudges
  add column fallback_reason text;
