---
"@openokr/web": patch
---

The Helm chart's install notes no longer warn that uploads go to an emptyDir when an S3 bucket is named. They say the files are kept in the bucket, and drop the single-replica note, which a bucket lifts.
