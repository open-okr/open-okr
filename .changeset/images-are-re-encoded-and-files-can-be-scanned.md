---
"@openokr/web": minor
---

Uploaded images are re-encoded and shown as previews, and files can be scanned
for viruses.

**Every uploaded image is written again before it is kept.** A PNG, JPEG, GIF
or WebP is decoded and saved anew in the type it claimed. What is stored is
pixels the instance drew rather than the bytes that arrived, so a photo's EXIF
block, with the camera and, from a phone, where it was taken, no longer comes
along. A file that says it is an image and is not one is refused with a message
saying so, and so is an image of more than 100 megapixels. A portrait photo
stays upright: the orientation the phone recorded is applied before the tag is
dropped.

**The file list shows what each file is.** An image has a small preview beside
it, and anything else the icon for its type, with the type named beside its
size. Images uploaded before this release keep their icon, because no preview
was made when they arrived.

**A virus scan is available, and off until you turn it on.** Set
`OPENOKR_CLAMD_HOST` to a ClamAV daemon the instance can reach (and
`OPENOKR_CLAMD_PORT` if it is not on 3310), in the environment, the Compose
file or the Helm chart's `scan.clamd` values. Each new upload is then listed as
being checked and cannot be opened until clamd answers. A file clamd flags, or
refuses to scan, is held back for good and never served, and the signature is
on the audit row. If clamd cannot be reached the file waits and the scan is
tried again. With nothing set, files are available as soon as they are
uploaded, as before, and nothing but Postgres has to run.

Nothing needs doing on upgrade. The image carries the image library for its own
platform, and nothing is downloaded when it first runs.
