---
"@openokr/web": minor
---

The Helm chart can autoscale the web pods. `autoscaling.enabled=true` adds an `autoscaling/v2` HorizontalPodAutoscaler on the web Deployment, from `autoscaling.minReplicas` (2) to `autoscaling.maxReplicas` (6) on CPU at `autoscaling.targetCPUUtilizationPercentage` (70), with an optional memory target, and the Deployment then sets no replica count. The web PDB renders when the floor is above one. Without a bucket or a `ReadWriteMany` volume a ceiling above one is refused, as a replica count above one already is, and so are a floor below one or above the ceiling and a CPU target below one. Off by default.
