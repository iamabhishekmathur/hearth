# Hearth Capability Claims Matrix

Last source review: August 26, 2026

Use this file when writing website, launch, sales, or documentation copy. It records what the product currently supports and the qualification that must remain attached to each claim.

## Workspace

| Area     | Current capability                                                                                              | Safe public language                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Chat     | Shared sessions, artifacts, reactions, feedback, integrations, and promote-to-task                              | Teammates and AI can work together in shared sessions with files, context, and artifacts.                                          |
| Tasks    | Owner-assigned Tasks, context, subtasks, execution steps, comments, replan, and approve/request-changes reviews | Agents can plan accountable work and return it for owner review.                                                                   |
| Routines | Manual, scheduled, event, and signed-webhook runs with run history and optional approval checkpoints            | Repeatable work can run on demand, on a schedule, or from a trigger. Routines can pause at configured approval checkpoints.        |
| Skills   | Published Skills can be surfaced through Activity and installed by teammates                                    | Successful instructions can become installable Skills for the team.                                                                |
| Activity | Audit-derived feed, signals, digest, reactions, and Skill installation                                          | Activity helps teammates discover published Skills and visible workspace events. Do not describe it as a complete adoption ledger. |

## Connections

| Connection      | Current capability                                                                            | Qualification                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slack           | Channel/message search, post message, signed inbound message intake, interactive Task actions | Bundled adapter and the primary supported intake signal.                                                                                              |
| Gmail           | Search, labels, send email                                                                    | Backfill/search is supported. Continuous polling is not complete.                                                                                     |
| Google Drive    | Search, list, and read files                                                                  | Read/context only.                                                                                                                                    |
| Google Calendar | List and get events                                                                           | Read/context only.                                                                                                                                    |
| GitHub          | Search code, repositories, and pull requests; create issues                                   | No bundled GitHub event intake.                                                                                                                       |
| Jira            | Search/get issues; create issues                                                              | No bundled Jira event intake.                                                                                                                         |
| Notion          | Search/get pages; create pages                                                                | No bundled Notion event intake.                                                                                                                       |
| Custom MCP      | Remote `tools/list` and `tools/call`                                                          | Additional systems depend on a buyer-provided compatible MCP server. Do not present Salesforce, Confluence, Granola, or Intercom as bundled adapters. |

## Governance And Trust

| Area                    | Current capability                                                                          | Qualification                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Governance policies     | Admin rules with monitor, warn, or block modes; violation review, statistics, and export    | Policies can evaluate configured prompts and model calls. Do not claim every external action is universally pre-approved. |
| Sensitive-data controls | PII, PCI, PHI, GDPR, FERPA, and financial detector packs; outbound chat/embedding scrubbing | These are product controls, not regulatory certifications.                                                                |
| Approval                | Task review/replan and optional Routine approval checkpoints                                | Chat tool calls are not universally gated before execution.                                                               |
| Audit                   | Logged LLM, tool, auth, governance, and selected business events                            | Do not claim a complete ledger of every Task, Routine, or Activity lifecycle event.                                       |
| SSO                     | Cloud WorkOS implementation is in progress                                                  | Describe as early access until provisioning is production-verified.                                                       |
| Cloud export            | Organization JSON export; audit CSV                                                         | Export is available. Automated Cloud-to-self-hosted import is not.                                                        |
| License                 | Core is AGPL-3.0-only; Cloud overlay uses the Hearth Enterprise License                     | Never describe the core as MIT licensed.                                                                                  |

## Deployment

- **Hearth Cloud** is the recommended evaluation path, beginning with a guided team pilot while public self-serve provisioning is closed.
- **Self-hosted Hearth** is the AGPL core for organizations that need source inspection, private-network deployment, local models, or direct infrastructure control.
- **BYO model configuration** is available across both paths, subject to the provider and deployment configuration.
- Cloud architecture and deployment controls are code-defined, but they are not evidence of a production certification.

## Claims To Avoid

- Native Granola, Salesforce, Confluence, or Intercom integration.
- Approval before every external action.
- Complete audit coverage of all product activity.
- Teammate Routine installation through Activity.
- GA enterprise SSO.
- Seamless Cloud-to-self-hosted migration.
- Compliance certification based only on detector packs or infrastructure code.
