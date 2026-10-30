# Friday-pAI technical hardening report

This update intentionally excludes Nebius Token Factory integration and the hackathon presentation.

## Implemented in this update

### Workflow execution and verification
- Added deterministic, workflow-specific success checks for the shipped workflows. Checks inspect actual step outputs (for example, non-empty search results, summaries, generated tasks, and inspected files) rather than treating the workflow definition's natural-language success criteria as proof.
- The run UI now displays the configured outcome checks and their results.
- Approval-required steps display a preview from their configured predecessor. File Organizer shows the proposed moves before approval; Project Assistant shows its review proposal; Research & Study shows its notes; Goal Planning shows the proposed tasks.
- Added the missing `cancelWorkflow` method to Electron's preload API; the UI's Cancel workflow control was calling an API method that had not been exposed.
- Prevented a run from launching a second executor while it is already active.
- Added bounded exponential retry delays and capped stored step error messages.
- Made file organization retries idempotent when the destination file's fingerprint proves that the move already completed. A changed source is rejected so a stale preview cannot silently move a modified file.
- Made note and project-review output paths deterministic per workflow run and refuse to overwrite differing content, avoiding duplicate artifacts on recovery.
- All shipped workflow definitions now advertise `ready`; Goal Planning is now a two-stage workflow: generate a deadline-aware plan, show it for approval, and then persist the approved goal/tasks.

### Memory and privacy
- Replaced the earlier token-overlap-only ranking with a local hybrid BM25 + sparse word/character-vector retrieval approach, concept expansion, category relevance, and recency tie-breaking.
- Workflow memory retrieval now considers nested prior-step evidence as well as original inputs. Goal planning also receives relevant saved memories.
- Added instructions for AI workflow steps to treat files, search results, prior outputs, and memories as evidence, not higher-priority instructions.
- Expanded credential rejection for saved memories to include labeled passwords/verification codes, common provider tokens, GitHub tokens, and other recognizable credential formats.
- Current-state fact replacement remains deliberately conservative. Ambiguous facts are not auto-deleted because several apparently conflicting facts can both be true.

### Persistent data and integrations
- Goals now use atomic file replacement, collision-resistant goal/task IDs, deterministic idempotency keys for workflow-created goals, and a separate-process persistence test.
- Existing goals migrate once to Electron's writable per-user `userData` directory. Existing workflow history and memory keep their migration paths; saved notes are written under `userData/notes` and legacy Markdown notes are copied when available.
- NVIDIA and Tavily requests now have timeouts, bounded error details, response validation, and credential-pattern redaction in provider errors.
- Added mock-based provider tests that validate success/error paths without using real keys or network access.

## Verification performed here

- `npm test`: PASS — 26 workflow tests, memory persistence/relevance/privacy tests, process-restart history test, file-operation safety/idempotency tests, goal persistence/ID tests, and mocked NVIDIA/Tavily client tests.
- `npm run check:main`: PASS — Node syntax checks for Electron main/preload, workflow engine, task recorder, secure file operations, goal manager/planner, memory context/store, and provider clients.
- `npm run test:api-smoke`: SKIPPED both live providers because no real `NVIDIA_API_KEY` or `TAVILY_API_KEY` was configured. Mocked client behavior passed, but that does not prove the real credentials/provider accounts work.
- `npm ci`: NOT VERIFIED; the install attempt stalled due to registry/network access in this environment. ESLint and Vite were therefore unavailable, so `npm run lint` and `npm run build` could not be completed here.
- Windows Electron GUI close/relaunch test: NOT VERIFIED in this Linux environment.

## Remaining verification limits

1. Run the supplied `verify-windows.ps1` on the target Windows PC with internet access to complete clean install, lint, production build, and live smoke tests.
2. Run a real workflow, close Friday-pAI completely, reopen it, and confirm goals, memory, notes, and workflow history persist in the packaged GUI.
3. Configure real NVIDIA/Tavily keys locally and verify actual provider responses/rate limits. Never paste keys into chat or commit `.env`.
4. Memory retrieval is now local BM25 plus sparse word/character vectors and a concept map, not a neural dense embedding model. This is privacy-preserving and offline but may still miss deeper paraphrases; a neural embedding provider would need a deliberate privacy/cost/latency decision.
5. Workflow checks verify configured structural outcomes, not every nuanced natural-language claim. For example, a non-empty research result array does not establish that each source is authoritative; higher-stakes workflows need domain-specific validators.

Nebius Token Factory integration and the hackathon presentation remain intentionally out of scope.
