-- Better Auth 1.7 identifies an account by its issuer.
--
-- 1.7 added a required `issuer` field to its account model and moved the
-- account's identity from (provider_id, account_id) to (issuer, account_id).
-- The value namespaces the authentication method so a provider id cannot
-- collide across two of them: `local:credential` for a password, and
-- `local:oauth:<provider>` for a social login.
--
-- Without the column Better Auth refuses to run at all. It does not degrade to
-- the old shape: registration, sign-in, session listing and session revocation
-- every one fail with "The field \"issuer\" does not exist in the \"account\"
-- Drizzle schema".
--
-- Added nullable, backfilled, then made not null, so the table is never
-- rewritten with a default and an existing instance keeps its accounts.

alter table accounts add column issuer text;

-- Every row this table can hold is a local one, so every row takes Better
-- Auth's local prefix. The shipped factors are a password and a passkey, the
-- passkey has its own table, and no social provider is configured, so
-- provider_id is "credential" here. The expression derives the value rather
-- than hardcoding it so a local provider added by a plugin is carried too.
--
-- `local:` is what createLocalAccountIssuer writes, and it url-encodes the
-- provider id. Ours are plain identifiers with nothing to encode, so the
-- concatenation matches the library byte for byte.
--
-- Deliberately not handled: a social login, which Better Auth namespaces as
-- `local:oauth:<provider>` instead. No such row can exist in a database this
-- migration upgrades, because no social provider ships. An operator who added
-- one through the plugin option would need those rows mapped to the oauth
-- namespace by hand, and would find them by provider_id.
update accounts set issuer = 'local:' || provider_id where issuer is null;

alter table accounts alter column issuer set not null;

-- The identity 1.7 actually reads.
alter table accounts add constraint accounts_issuer_account_id_key
  unique (issuer, account_id);

-- The old pair stays for one more release. A rolling upgrade still has 1.6
-- nodes reading it, and dropping what the previous release relies on is what
-- PLAN.md 5.1's two-release rule exists to prevent. The release after this one
-- drops it.
