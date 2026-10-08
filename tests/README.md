# Komal L4 test suite

End-to-end tests for the **Komal AI assistant** (this workspace). They validate two
things that the chat itself can't prove on its own:

1. **Routing/allocation rules** — the documented branch rules from
   `.dsh/skills/patient-intake.md` (Lahore 75/25, Karachi 65/35 + PRP→SMCHS,
   Islamabad 75/25, non-surgical hubs) as a contract test.
2. **CRM side effects** — the Supabase writes Komal performs (lead lookup/create,
   wa_messages logging, booking via `book_appointment`, follow-up messages) run
   exactly as the skill instructs, against **staging**.

Plus `LIVE_CONVERSATIONS.md` — manual scripts to run the real agent in chat.

## Layout

| File | Purpose |
|---|---|
| `rules.mjs` | The documented routing rules as pure functions (single source the scenarios check) |
| `komal-lib.mjs` | Tiny harness: env, REST/RPC helpers, test users, assertions, cleanup |
| `komal-run.mjs` | Runner: config↔DB check → rules contract → CRM simulation → transcripts |
| `scenarios/*.json` | One file per behaviour; hand-computed expected branch codes |
| `LIVE_CONVERSATIONS.md` | Manual scripts for the live agent chat |

## Setup (once)

1. Use the **staging** Supabase project (same one as the Canopy L2 suite). Do not run
   writes against the live project in `.env`.
2. `copy .env.test.example .env.test` at this workspace root and fill in the staging
   `SUPABASE_URL` / `SERVICE_ROLE_KEY` / `ANON_KEY` (the runner reads `.env.test` first,
   then falls back to `.env`).
3. The staging project needs the Canopy migrations applied and `book_appointment` RPC
   present (the Canopy L2 README covers this).

## Run

```bash
node tests/komal/komal-run.mjs     # or: npm run test:komal
```

The suite creates only test leads (`+92 0000 0000xx` numbers, never real patients),
registers cleanup for everything it creates, and exits non-zero on any failure.

## Drift you may see

- `interested_procedure` enum values `hair_transplant` / `non_surgical` are now
  **versioned** in Canopy migration `0021` (`alter type procedure_type add value ...`),
  so a staging DB pushed through `0021` accepts Komal's intake writes directly. If your
  staging DB predates `0021`, the runner logs a warning and stores a migration-safe
  value (`fue` / `other`) instead of failing — apply `0021` to remove the warning.
- The booking phase creates its own consultant profile (staging seeds none) and cleans
  it up after.

## Live-agent mode

Run the transcripts in `LIVE_CONVERSATIONS.md` against the real Komal chat (DSH web GUI
or the WhatsApp bridge) and tick the expected outcomes.
