# Cloud vs Self-Hosted

Hearth Cloud and self-hosted Hearth expose the same core product concepts: chat, tasks, routines, memory, skills, activity, decisions, integrations, and admin controls. The main difference is who operates the infrastructure and where operational responsibility lives.

[[toc]]

## Summary

| Area | Hearth Cloud | Self-hosted OSS |
|---|---|---|
| Hosting | Managed by Hearth | Managed by your team |
| Source access | Product docs and public repo apply where relevant | Full open-source codebase |
| Updates | Managed service updates | You pull, build, deploy, and migrate |
| Database | Hosted as part of the service | Your Postgres with pgvector |
| Redis and queues | Hosted as part of the service | Your Redis and BullMQ workers |
| Backups | Managed service responsibility, subject to your agreement | Your responsibility |
| Network controls | Cloud workspace controls plus provider security posture | Your VPC, ingress, firewall, VPN, and private networking |
| LLM providers | Configure provider behavior in the workspace | Configure through env vars and admin settings |
| Local models | Depends on cloud connectivity and supported configuration | Supported through self-managed Ollama endpoints |
| Custom code changes | Not intended for per-customer code forks | Fully customizable |
| Operational burden | Lower | Higher |
| Best fit | Teams that want fast rollout and managed operations | Teams that need control, customization, or on-prem operation |

## Choose Hearth Cloud If

- You want the fastest production rollout.
- You do not want to operate Postgres, Redis, workers, backups, TLS, or upgrades.
- Your team values the product workflow more than infrastructure control.
- Your security requirements can be met by a managed cloud deployment.

## Choose Self-Hosted If

- You need source-level customization.
- You need to run Hearth inside your own network.
- You need direct control over database, Redis, storage, backups, and deployment cadence.
- You want local model support through infrastructure you operate.
- You need to integrate with private systems that are not reachable from a managed cloud workspace.

## Product Docs Are Shared

Most feature docs apply to both editions:

- [Chat](/guide/chat)
- [Tasks](/guide/tasks)
- [Routines](/guide/routines)
- [Memory](/guide/memory)
- [Skills](/guide/skills)
- [Admin Guide](/admin/)

Edition-specific docs cover setup, security posture, operational duties, and deployment mechanics.
