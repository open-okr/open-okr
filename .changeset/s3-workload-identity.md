---
"@openokr/web": minor
---

File storage on S3 no longer needs a long-lived access key. With a bucket named and no key pair, the AWS SDK finds the server's own credentials, so EKS Pod Identity, IRSA or an instance profile can be used; the Helm chart no longer requires `storage.s3.existingSecret`. Half a key pair is still refused at start.
