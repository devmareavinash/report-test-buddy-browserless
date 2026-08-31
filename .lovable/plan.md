## Scope

Fourteen feature updates **plus a cloud-agnostic architecture** that targets AWS-native services in production while remaining portable. Full Playwright runtime is preserved (headed live-debug + headless execution).

---

## A. Cloud-agnostic architecture

The app will be coded against **thin provider interfaces** so it can run on any cloud. The reference production deployment targets **AWS native services**, but no business logic imports a vendor SDK directly.

### Provider interfaces (in `src/lib/platform/` and `supabase/functions/_shared/platform/`)
- `DbAdapter` — `query`, `insert`, `update`, `delete`, `rpc`. Implementations: `PostgresAdapter` (works against Supabase Postgres today, AWS RDS/Aurora Postgres in prod).
- `AuthAdapter` — `signIn`, `signUp`, `getSession`. Implementations: `SupabaseAuthAdapter`, `CognitoAdapter`.
- `StorageAdapter` — `putObject`, `getSignedUrl`. Implementations: `SupabaseStorageAdapter`, `S3Adapter`.
- `QueueAdapter` — `enqueue(jobName, payload)`. Implementations: `InlineAdapter` (current edge functions), `SqsAdapter`.
- `SecretsAdapter` — `get(name)`. Implementations: `EnvAdapter`, `AwsSecretsManagerAdapter`.
- `LlmAdapter` — already provider-agnostic (`ai_gateway`, `openai`, `anthropic`, `bedrock`, `custom_wrapper`). Bedrock is the AWS-native default.
- `BrowserRuntimeAdapter` — `runHeaded`, `runHeadless`. Implementations: `BrowserlessAdapter`, `BrowserBaseAdapter`, `EcsFargatePlaywrightAdapter` (AWS-native: Playwright container on Fargate exposing CDP + noVNC).

A single `platform.ts` factory selects the implementation from `PLATFORM_PROVIDER` env (`supabase` | `aws`).

### AWS reference deployment (documented in `infra/README.md`)
- **Frontend**: Vite build → S3 + CloudFront.
- **API / agents**: Edge function logic ported to **Lambda** (Node 20) behind **API Gateway HTTP API**; or container on **ECS Fargate** for long Playwright jobs.
- **DB**: **RDS Aurora Postgres Serverless v2** (same SQL schema as today's migration).
- **Auth**: **Cognito User Pools** (or keep Supabase Auth via the adapter).
- **Storage**: **S3** bucket `bi-test-artifacts` for screenshots/DOM snapshots.
- **Secrets**: **AWS Secrets Manager** for LLM keys, warehouse creds, browser endpoint creds.
- **Schedules**: **EventBridge** rules invoking the orchestrator Lambda (replaces pg_cron).
- **Queue**: **SQS** between trigger → orchestrator → playwright-runtime workers on Fargate.
- **External trigger API**: API Gateway endpoint mirroring `trigger-run`, validating tokens via Secrets Manager.
- **Playwright workers**: Fargate task with Playwright + Chromium + noVNC; ALB exposes the `live_url` for first-run headed debugging.
- **Observability**: CloudWatch Logs + Metrics; X-Ray traces optional.
- **IaC**: Terraform skeleton in `infra/terraform/` (modules: `network`, `rds`, `lambda-orchestrator`, `fargate-playwright`, `eventbridge`, `s3-artifacts`, `cognito`).

### What ships in Lovable today vs. what AWS picks up later
- All app code uses the adapters above. The Lovable preview runs the `supabase` provider (RDS-equivalent Postgres, edge functions, storage). Switching to AWS in prod is config + deploy of Terraform — no business-logic changes required.
- No vendor-locked imports inside `src/pages/**` or `supabase/functions/agent-*` — they go through the adapters.

---

## B. Schema migration (one migration, vendor-neutral SQL)
- `reports`: add `workstream_id` (backfill from brands, then NOT NULL); `brand_id` becomes optional and unused.
- `scenarios`: add `deferred bool`, `criticality text`, `prerun_id uuid null`.
- New `prerun_scripts` (shared login/filter steps per report).
- New `scenario_filter_matrix` (filter combos per scenario).
- `llm_providers`: extend `kind` (`ai_gateway`, `openai`, `anthropic`, `google`, `azure_openai`, `bedrock`, `custom_wrapper`); add `wrapper_payload_template`, `extra.headers`. Drop "Lovable" wording in UI.
- `agent_model_config`: add `system_instruction`.
- `test_results`: add `criticality`.
- New `playwright_jobs`: `id, scenario_id, mode, status, live_url, last_event`.

## C. Frontend updates (all 14 items)
1. Failed-checks tile on dashboard → `Link` to `/runs?status=fail`.
2. Dashboard "Summary by Workstream" card.
3. Brand layer removed from UI; tree is Workstream → Reports.
4. Inline edit of report URL & reference URL in `Reports.tsx` and `ReportDetail.tsx`.
5. Prerun script editor on `ReportDetail.tsx` + filter-matrix editor per scenario.
6. Scenario rows clickable → new `ScenarioDetail.tsx` with Playwright code editor.
7. Edit / Add / Delete scenario from `ReportDetail.tsx`.
8. SQL templates UI exposes scope (Project | Report) + report selector.
9. Agent model config: per-agent `system_instruction` textarea.
10. Schedules UI: scope = workstream | report.
11. External-trigger API tokens: scope picker (workstream | report) generates curl example.
12. Dashboard footer link → deferred/ignored scenarios list.
13. Criticality computed and shown on each test result (combines scenario.criticality + |diff.pct|).
14. LLM Providers UI: rename "Lovable AI" → "AI Gateway"; add Custom Wrapper kind (base_url + headers JSON + payload template).

## D. Playwright runtime (kept full)
- New `playwright-runtime` function that delegates to `BrowserRuntimeAdapter`.
- Headed mode returns a `live_url` (noVNC/CDP) embedded in `ScenarioDetail.tsx` so the user can watch + iterate on first-run authoring.
- Headless mode persists screenshot + DOM snapshot via `StorageAdapter` (S3 in prod, Supabase Storage in preview) and writes URLs onto `test_results`.

## E. Edge / serverless function updates
- `agent-orchestrate`: accept `workstream` | `report`; expand filter matrix; compute criticality; route to `BrowserRuntimeAdapter`.
- `trigger-run`: `{scope_type: workstream|report, scope_id}`.
- `_shared/llm.ts`: add `custom_wrapper` (POST base_url with payload template + headers); rename `lovable_ai` → `ai_gateway` internally.
- New `playwright-runtime/index.ts`.
- All read/write goes through the new adapter modules so the same code lifts to Lambda.

## Files
- 1 migration + 1 storage bucket
- New `src/lib/platform/*.ts` (adapter interfaces + Supabase impls)
- New `supabase/functions/_shared/platform/*.ts` (server-side adapters + AWS impl stubs)
- `src/pages/Dashboard.tsx`, `Reports.tsx`, `ReportDetail.tsx`, `Settings.tsx`, `SqlTemplates.tsx`, `Runs.tsx`
- New `src/pages/ScenarioDetail.tsx`
- `src/App.tsx` route
- Edge functions above + new `playwright-runtime`
- `infra/README.md` + `infra/terraform/` skeleton (AWS reference)

Reply approve to proceed; I'll run the migration first, then ship the code.
