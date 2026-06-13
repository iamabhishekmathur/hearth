# Onboarding simulation suite

End-to-end simulations of a **brand-new company's first run** through Hearth —
from blank-slate org creation to the first teammate, first integration, and
first personalized reply. Every assertion is driven through the **real user
entry point** (REST + the live agent + the BullMQ workers), never by writing
rows directly, so we observe what an actual new customer would experience.

## What this suite tests

This wave is about **trigger fidelity**: most onboarding value in Hearth is born
from *indirect* triggers (an agent tool call mid-chat, a background worker, a
cross-service event) rather than a direct `POST`. The sims drive chat / workers
and then verify the side effect via REST GETs — confirming the right trigger
fired for genuine input and stayed silent on noise.

| Sim | Journey |
| --- | --- |
| `genesis.sim.ts` | Blank slate → `POST /admin/setup/init` (org + first admin) → cold-start cliff (chat **before** any LLM) → configure LLM via the real wizard (`test-llm` → `keys` → `llm-config`) → empty-state sweep. |
| `activation-triggers.sim.ts` | Fresh member holds a real conversation; a decision (`capture_decision`), a memory (`save_memory` + cross-session recall), and a task (`create_task`) are born through their **real indirect triggers** — plus negative controls (unresolved debate, plain question). |
| `teammates-join.sim.ts` | Self-register teammates, admin promotion path, and probes for invite / accept / email-verification flows (which do not exist). |
| `integration-deadzone.sim.ts` | Connect a first integration and prove the immediate-value dead-zone (no synthesis / no task detection / no backfill on connect). |
| `coldstart.sim.ts` | Cold-start personalization: the cognitive-profile gate (off by default) and the proactive surfaces (recommendations / signals / activity / digest). |

## Prerequisite: the ISOLATED :8100 instance

> **These sims run against an isolated fresh instance on `:8100`, NOT the dev
> `:8000` instance.** They create orgs, register users, configure LLM keys, and
> spend real Anthropic tokens. Running them against a shared/dev DB will
> pollute it and the genesis sim will report `Setup already completed`.

The isolated instance is a separate API + worker process pointed at a throwaway
database (`hearth_onboard`) and a separate Redis (`:6380`). The genesis sim
reads the real `ANTHROPIC_API_KEY` from the repo-root `.env` and configures it
into the fresh org via the admin wizard — **the key is never logged**.

Because the throwaway DB **persists between runs**, re-running `genesis.sim.ts`
against an already-bootstrapped DB will hit `Setup already completed` on
`/admin/setup/init` (expected). For an authoritative clean run, reset the
`hearth_onboard` database first.

## Running

Run the whole suite, in order (genesis must run first — it leaves behind the
org + working LLM key the other journeys depend on):

```bash
API_URL=http://localhost:8100/api/v1 \
  ./apps/api/node_modules/.bin/tsx load/onboarding/run-all.ts
```

Run a single journey:

```bash
API_URL=http://localhost:8100/api/v1 \
  ./apps/api/node_modules/.bin/tsx load/onboarding/activation-triggers.sim.ts
```

Discover / list the ordered sims without running them:

```bash
./apps/api/node_modules/.bin/tsx load/onboarding/run-all.ts --list
```

### Env / flags

| Var | Default | Purpose |
| --- | --- | --- |
| `API_URL` | `http://localhost:8100/api/v1` | Target the isolated onboarding instance. |
| `ONBOARDING_ONLY` | _(all)_ | Comma-separated basename substrings, e.g. `ONBOARDING_ONLY=genesis,coldstart`. |
| `ONBOARDING_TIMEOUT_MS` | `600000` | Per-sim wall-clock timeout (10 min). |

## Reading the results

The runner prints a `PASS`/`FAIL` banner per sim and a final rollup. **A sim
only hard-FAILs on a non-zero exit (crash/timeout).** Several onboarding sims
are **verdict sims**: they intentionally record `status:"fail"` results for
reasoned negative findings (e.g. "cognitive personalization is gated off by
default", "connecting an integration triggers no synthesis") without crashing.
Those surface as a `reported_fail=N` tally on an otherwise-passing sim — they are
**findings, not crashes**. Read the sim's own JSON `===== RESULT =====` block for
the per-assertion detail behind any tally.

## Files in this directory

- `run-all.ts` — sequential, deliberately-ordered suite runner (this suite).
- `TRIGGER-MAP.md` — the catalog of onboarding-relevant capabilities and the
  exact indirect trigger + downstream assert + negative case for each.
- `genesis.sim.ts`
- `activation-triggers.sim.ts`
- `teammates-join.sim.ts`
- `integration-deadzone.sim.ts`
- `coldstart.sim.ts`
- `README.md` — this file.
