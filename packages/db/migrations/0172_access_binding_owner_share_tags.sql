alter table access_bindings drop constraint access_bindings_tag_check;
alter table access_bindings add constraint access_bindings_tag_check
  check (tag in ('champion', 'reviewer', 'sponsor', 'facilitator',
                 'coordinator', 'owner', 'share')) not valid;
alter table access_bindings validate constraint access_bindings_tag_check;
