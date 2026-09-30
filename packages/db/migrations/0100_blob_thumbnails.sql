-- Where an image's thumbnail is kept (TECHNICAL-PLAN §4.9, completeness review
-- M-24).
--
-- **An uploaded image is now re-encoded and gets a small WebP beside it**, so
-- the attachment list can show the picture rather than a file name. The
-- thumbnail is its own object in the storage port, and this column is the key
-- it sits under. Null means there is none: a PDF, a spreadsheet, an image
-- restored from an archive (the archive carries the file and not the preview
-- made of it), and every image uploaded before this release.
--
-- **Set by the server, never by a caller.** The claim derives it from the
-- blob's own storage key, so no request can point a blob's preview at another
-- workspace's object.
--
-- Additive and nullable, so the previous release reads the table unchanged and
-- a rolling upgrade has nothing to reconcile. `blobs` already carries its
-- tenant policy from migration 0011, and a new column inherits it.
alter table blobs
  add column thumbnail_key text;
