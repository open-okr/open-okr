# Security policy

## Supported versions

The latest minor release gets security fixes. Today that is 0.6.x. Older minor releases do not.

| Version | Fixes |
|---|---|
| 0.6.x | Yes |
| Older | No |

## How to report a vulnerability

Use GitHub private vulnerability reporting. Open the Security tab of this repository and choose "Report a vulnerability".

Do not open a public issue, pull request or discussion for a vulnerability.

## What to include

- The version or commit, and how it is deployed (self-hosted Docker Compose, Helm or managed cloud).
- What the problem is and what an attacker gains from it.
- Steps to reproduce, or a proof of concept.
- Any logs, requests or screenshots that help.
- How you want to be credited, or that you want to stay anonymous.

## What to expect

| Step | Target |
|---|---|
| Acknowledgement | Within 3 working days |
| Triage and severity | Within 7 days |
| Fix or mitigation plan, for High and Critical | Within 30 days |

Lower severities are scheduled with the normal release train. You will be told where your report stands at each step.

## Coordinated disclosure

Please keep the report private until a fixed release is out. When it is, we publish a GitHub security advisory and credit you if you asked for that. If a fix takes longer than planned, we agree a disclosure date with you.

## Scope

In scope:

- This repository.
- The official container images.
- The official Helm chart.

Out of scope: instances run by other people, third-party services the product connects to, and reports that only describe missing hardening with no demonstrated effect.
