# AGENTS.md: working on HomeBot Founders Edition

This is the operating guide for AI coding agents (and the humans who work beside
them). Load it at the start of a session. It says what the system promises, where
each promise is enforced, and how to change the code without breaking one.

The reference architecture, with diagrams and the request flows, is
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The product overview is
[`README.md`](README.md). When a document and the code disagree, the code is the
truth; fix the document in the same change.

## 1. What this system is, and what it promises

HomeBot Founders Edition is the full HomeBot build of PuffPAI for a Jetson AGX
Orin: a household AI that runs on hardware the owner holds. Every PuffPAI has three
zones:

- **The Vault**: personal data, encrypted, caught automatically and kept out of the
  AI's memory; even the AI needs the owner's permission to look.
- **The Brain**: local models, agents, tools and knowledge.
- **The Bridge**: the only way to the outside. Every way out has a name and a
  switch, and the Bridge ships closed.

The promises to the owner. A change that weakens one of these is a bug, however
useful the feature is:

1. **Local first.** Inference, orchestration, voice and knowledge search run on the
   box. Core features work with the internet unplugged.
2. **Zero telemetry, no subscriptions.** Nothing phones home. There is no
   activation, licence server, analytics or crash reporter, and none may be added.
3. **The Bridge ships closed.** Every outbound destination is a named entry with a
   fixed host list, a stated purpose, a plain statement of what leaves, and a switch
   that defaults to off.
4. **The Vault asks first.** Vault contents are encrypted at rest and released only
   after a PIN. A turn that carries vault content is never saved to chat history or
   written to the voice journal, and a spoken PIN is withheld from the live
   transcript the dashboard shows.
5. **Actions are gated.** Agents propose; state-changing actions pass the
   Drawbridge veto, per-device consent, and for safety-critical devices a human
   confirmation that no model or request body can forge.
6. **Honest answers.** When something is switched off, missing or failed, the
   reply says so. It never fabricates data or silently substitutes another source.

No packet filter ships turned on. Every gate above is application code. See
[`SECURITY.md`](SECURITY.md) for the trust boundary stated plainly.

**Known gaps.** These are real and are not yet closed; do not write code or docs
that assume otherwise, and prefer changes that close them:

- The dashboard's own server routes that reach the internet (`app/api/radio/*`,
  `app/api/tunein/*`, `app/api/reader`) ask the backend whether their switch is open
  (`GET /system/egress/door/<id>`, via `app/_lib/server/bridgeSwitch.ts`) before any
  lookup or socket, and refuse when it is off or the answer is missing. They are not
  the registry's wrapper, though: they do not pin the looked-up address and their
  requests are not written to the egress ledger. A playing radio stream (browser
  `<audio>` or the server-side mpv container) connects to the station's host
  directly, with no switch.
- The librespot containers (`docker-compose.spotify*.yml`) connect to Spotify on
  their own while they run. The `spotify` switch covers `spotify_control.py` only;
  stopping the container is the switch for librespot.
- Node-RED flows, once imported, make their own calls (`api.weather.gov`, the feed
  in `NEWS_RSS_URL`). Each outbound function node asks the backend
  (`GET /system/egress/door/<id>`) first and skips the call unless the answer is a
  clear yes, and `automation_client.WEBHOOK_SWITCHES` stops the backend from
  starting those flows while `weather` or `news_rss` is off. A copy of the flows
  without that check does not ask, and its two-hourly weather-alert schedule
  still calls out; the feed in `NEWS_RSS_URL` is not one of the hosts the
  `news_rss` entry lists.
- App data (`app_data/*.json`) and chat history are plain files protected by file
  permissions only, not encrypted; chat history stores the redacted text.

## 2. Repository map

| Path | What lives there |
|---|---|
| `start_api.py` | Backend entry point used by `puffpai-api.service`: logging, background services, Flask on `:8000` |
| `src/puffpai/api_server.py` | The Flask app: nearly every HTTP route, the request hooks (`_rate_limit`, `_check_api_key`), chat and voice turn handling, vault chat state |
| `src/puffpai/bridge_routes.py`, `hatch_api.py` | The `/bridge/*` blueprint and the `/hatch*` routes, registered onto the same app |
| `src/puffpai/assistant_tools.py` | `AssistantTools`: the LLM tool layer (`create_tools()` defines each `@tool`), daily briefing, the legacy tool loop |
| `src/puffpai/persona.txt` | The persona prompt, with an `{ai_name}` placeholder; the shipped default name is `PuffPAI` |
| `src/puffpai/agent_graph.py`, `router.py` | LangGraph agent over the tools; the keyword router (`route_message`) |
| `src/puffpai/capability_registry.py` | One declaration per capability: authority tool, keywords, owning agent, surfaces, status |
| `src/puffpai/agents/` | The agent team: `bus.py`, `envelope.py`, `registry.py` (the roster), one module per agent, `planning_loop.py`, `engine.py`, `dispatcher.py` |
| `src/puffpai/security/` | Vault, Scrub-and-Vault, the Bridge registry (`egress_doors.py`, `egress_admin.py`, `egress_policy.py`, `egress_ledger.py`, `netaddr.py`, `lan_http.py`), `endpoint_gate.py`, consent, secrets provider, audit log |
| `src/puffpai/voice/` | On-box voice service: wake, capture, STT, TTS, ducking, journal privacy |
| `src/puffpai/knowledge/` | Own ZIM reader, SQLite FTS5 shards, shard browsing, ChromaDB RAG, discovery |
| `src/puffpai/skills/`, `skills_examples/` | Sandboxed, consent-installed skills; one worked example |
| `src/puffpai/app_registry.py`, `app_data.py`, `apps/`, `packs/` | Declarative apps (`apps/<id>/app.json`), their JSON data, app packs |
| `src/puffpai/ha_bridge.py`, `ha_provisioning.py`, `zigbee_*.py`, `home_*.py` | Home Assistant control and its gates, provisioning under consent, Zigbee pairing, the home blueprint |
| `src/puffpai/media_hub.py`, `media_bridge.py`, `radio_player.py`, `books/` | Radio, Jellyfin, server-side playback, the Calibre librarian |
| `src/puffpai/zone3/`, `bridge_*.py`, `firewall_manager.py`, `device_sentinel.py` | AdGuard DNS control, device inventory and traffic ledger, the opt-in nftables backend, LAN device scanning |
| `src/puffpai/automation_client.py`, `nodered_flows/` | Node-RED client (`/automation/*` routes) and the importable flows |
| `src/puffpai/config.py`, `statedir.py` | Config dataclasses, `get_config()`, `resolve_state_dir()` |
| `dashboard/` | Next.js dashboard on `:3003`: pages under `app/dashboard/`, server routes under `app/api/`, the pairing gate and proxy under `app/_lib/server/`, `middleware.ts` |
| `systemd/`, `kiosk/`, `docker-compose.*.yml`, `searxng/` | Units and drop-ins, the wall-display session, container stacks |
| `config/` | `puffpai_config.json`, templates and seeds; the knowledge pack list (`capability_catalog.json`, `source_registry.json`) |
| `scripts/` | Installers, provisioning, migrations, `gen_egress_doc.py`, `precommit-secret-scan.sh` |
| `docs/` | Operator and design documents (list in section 8) |
| `tests/` | The pytest suite; `conftest.py` isolates keyring, secrets and Bridge state |

## 3. Running it

Backend on a development machine (Python 3.10 or newer; Ollama on `127.0.0.1:11434`
for anything that needs a model):

```bash
python -m venv venv && . venv/bin/activate
pip install -r requirements.txt && pip install -e ".[dev]"
export PUFFPAI_API_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')"
export PUFFPAI_DATA_DIR="$PWD/.state"      # writable state root; keep it out of src/
python start_api.py                         # Flask on :8000; every route but /health needs the key
```

The backend refuses to start without an API key it can resolve (vault, OS keyring,
environment). It will not invent one unless `PUFFPAI_PROVISION_API_KEY=1` is set
for a single start.

Dashboard (Node 20.19+ or 22.12+):

```bash
cd dashboard && npm ci
printf 'PUFFPAI_BACKEND_URL=http://127.0.0.1:8000\nPUFFPAI_API_KEY=%s\n' "$PUFFPAI_API_KEY" > .env.local
npm run dev                                 # next dev on :3003
```

Voice, without a microphone: `python -m puffpai.voice.service --selftest`.
On the Orin the installer does all of this: [`docs/INSTALL_ORIN.md`](docs/INSTALL_ORIN.md).
Every setting and environment variable: [`docs/CONFIG.md`](docs/CONFIG.md).

## 4. Running the tests

Always run pytest isolated, so nothing reads your OS keyring, a real key or your
real state:

```bash
PYTHONPATH=src \
PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring \
PUFFPAI_API_KEY=test-key-not-a-secret \
PUFFPAI_DATA_DIR="$(mktemp -d)" PUFFPAI_STATE_DIR="$(mktemp -d)" \
python -m pytest -q -p no:cacheprovider tests/test_release_doors_shut.py
```

`PUFFPAI_DATA_DIR` is the state root the runtime reads; `PUFFPAI_STATE_DIR` is
read by the installer only and is set here so no path falls back to a shared one.
`tests/conftest.py` adds its own guards: the keyring tier is off, keyring writes
raise, and the Bridge overlay files live in a temporary directory.

- **The full suite is large** (well over ten thousand tests) and **has known
  failures** (the README's Test status paragraph records the current count and
  the groups they fall into). Do not aim for zero. Run the tests your change
  touches, then compare the full-suite failure list before and after your change:
  a failure that was already there is not yours, a new one is.
- Some tests are order-dependent in a single process. If a failure appears only in
  a full run, re-run that file alone before concluding anything.
- Tests must not touch the network. Mock the transport or use the fixtures that
  make every socket primitive raise (see the Bridge tests for the pattern).
- Dashboard: `cd dashboard && npx tsc --noEmit`, then the `node` test scripts in
  `package.json` (`npm run test:pairing`, `test:proxy`, `test:proxyheaders`,
  `test:reader`, and the rest). They are plain `node` files under
  `app/**/__tests__/*.test.mjs`.
- Bridge document: `python scripts/gen_egress_doc.py --check` must report in sync.

There is no CI on this repository. You are the CI: say which commands you ran and
what they returned.

## 5. Contracts and invariants

Each line: the rule, the code that enforces it, the test that pins it. Test files
are named where the name is stable; otherwise the test function is named, and
`pytest -k <name>` or a grep under `tests/` finds it.

**The Bridge**

1. **Every switch ships off; anything unreadable counts as off.** Each `Door` row in
   `security/egress_doors.py` `DOORS` has `default=False`; `egress_allowed()` and
   `_resolve_flag()` treat a missing, junk or unreadable value as shut.
   Tests: `tests/test_release_doors_shut.py`; `test_every_door_declares_default_off`,
   `test_unreadable_config_leaves_every_door_shut`, `test_junk_flag_value_is_not_consent`.
2. **No outbound call in `src/puffpai` outside the registry.** WAN calls go through
   `egress_get()` / `egress_request()`; house-local calls go through
   `security/lan_http.py`, which refuses any public address. Tests:
   `test_no_outbound_call_site_outside_the_registry` (scans for `requests`,
   `urllib`, `httpx`, `aiohttp`, websockets and `create_connection`, and for
   calls made through a client object such as `session.get`, with a
   written allowlist of loopback and LAN call sites) and
   `test_every_wan_hostname_in_the_tree_belongs_to_a_door`.
3. **A shut switch refuses before any DNS lookup or socket; an open one reaches only
   its declared hosts, only at public addresses, pinned, with every redirect
   re-checked.** `require_open()` runs before `_check_url()`; `netaddr.py` pins the
   connection. Tests: `test_shut_door_refuses_without_opening_a_socket`,
   `test_open_door_still_refuses_an_undeclared_host`,
   `test_redirect_off_the_door_hosts_is_refused`,
   `tests/test_netaddr_resolver_cap.py`.
4. **Switch precedence is environment, then owner overlay, then config, then off.**
   Only `security/egress_admin.py` writes, and only to
   `$PUFFPAI_DATA_DIR/state/egress_doors.json`; a switch forced by
   `PUFFPAI_EGRESS_*`, an unenforced entry or a derived one cannot be changed from
   the UI (409). Tests: `test_environment_can_force_a_door_shut`,
   `test_doors_this_registry_does_not_control_are_409`.
5. **Chat reaches outward only with both the owner's chat opt-in and an open web
   switch; a planned run inherits egress and never mints it.**
   `api_server._chat_envelope_budget()`, `security/egress_policy.chat_egress_allowed()`,
   `agents/planning_loop.PlanningLoop._derive_budget()`. Tests:
   `tests/test_chat_egress_optin.py`, `tests/test_chat_envelope_budget.py`,
   `tests/test_planning_loop_egress.py`.
6. **Every decision, allowed or refused, is ledgered without content.**
   `security/egress_ledger.py` keeps host, path and byte counts, never query
   strings, bodies, headers, tokens or the private address a name resolved to.
   Test: `test_last_used_is_recorded_on_an_allowed_call` (no query string survives).

**Access to the backend**

7. **Every route except a justified few needs the API key.** `_check_api_key` in
   `api_server.py`; `_PUBLIC_ENDPOINTS` must equal
   `endpoint_gate.PUBLIC_ENDPOINT_JUSTIFICATIONS`; `LOCAL_ONLY_ENDPOINTS` are
   keyless for a loopback peer only; `X-Forwarded-For` is never parsed unless
   `api_server.trusted_proxy_hops` > 0. Tests: `tests/test_api_key_failclosed.py`,
   `tests/test_release_api_key.py`, `test_every_public_endpoint_has_a_written_reason`,
   `test_forwarded_for_cannot_forge_loopback`.
8. **Identity is asserted only by trusted peers.** `X-Puff-Device-Id` is believed
   only from loopback or an address in `PUFFPAI_TRUSTED_PROXY_IPS` (no wildcard);
   `X-Puff-Anonymous` yields a single-use session with no vault answers.
   `api_server._get_chat_client_id()`, dashboard `app/_lib/server/proxyHeaders.ts`
   `upstreamHeaders()`. Tests: `tests/test_release_chat_session_identity.py`,
   `tests/test_release_chat_anonymous_session.py`, `dashboard/app/_lib/server/__tests__/proxy-headers.test.mjs`.
9. **Only paired devices use the keyed proxy, and only for listed prefixes.**
   `dashboard/middleware.ts` and `requirePairing()` in `app/_lib/server/pairing.ts`
   (modes `off`, `knowledge` (default), `all`; an unknown value means `all`);
   `app/_lib/server/proxyAllowlist.ts` returns 404 off the list. Tests:
   `pairing-gate.test.mjs`, `pairing-cookie.test.mjs`, `proxy-guard.test.mjs`.

**Agents and actions**

10. **Every state-changing envelope is reviewed by Drawbridge (id `sentinel`); no
    reviewer means deny.** `agents/bus.py` `AgentBus.send()` / `_review()`,
    `agents/sentinel_agent.py` `review()`. Tests: `tests/test_agent_team.py`
    (`test_veto_blocks_state_change_to_steward`, `test_bus_fails_closed_without_reviewer`),
    `tests/test_sentinel_veto_shape.py`.
11. **Agents hold only the secrets their scope allows; Concierge and Toolsmith hold
    none.** `security/secrets_provider.py` `_SCOPE_ALLOW`, `agents/base.py`
    `BaseAgent.secret()`. Test: `test_concierge_holds_no_secrets` in `tests/test_agent_team.py`.
12. **Safety-critical Home Assistant domains need a human confirmation object that
    no JSON can carry; untargeted and broadcast calls are refused.** `ha_bridge.py`
    `SAFETY_CRITICAL_DOMAINS`, `HUMAN_CONFIRMED`, `ConfirmationRequired`. Tests:
    `tests/test_ha_bridge_confirmation_gate.py`, `tests/test_ha_confirmation_tickets.py`,
    `tests/test_ha_untargeted_gate.py`, `tests/test_ha_broadcast_gate.py`,
    `tests/test_agent_task_ha_gate.py`.
13. **The planner's catalogue, the agents' state-changing sets and the router agree.**
    `planning_loop.CATALOGUE`, `steward.STATE_CHANGING_INTENTS`,
    `concierge.RESOLVABLE_INTENTS`. Tests: `tests/test_capability_contract.py`,
    `tests/test_planner_registry_contract.py`.

**The Vault and privacy**

14. **Vault turns are never persisted or displayed.** `_register_private_turn()` and
    the `private: true` stream flag in `api_server.py`; `VAULT_PRIVATE_TOOLS` in
    `assistant_tools.py`. Tests: `tests/test_vault_unlocked_turn_private.py`,
    `tests/test_vault_tool_turn_private.py`, `tests/test_vault_save_back_private.py`.
15. **The voice journal never records a PIN or a private reply, and the live
    transcript withholds a PIN turn; decisions fail closed.** `voice/log_privacy.py`,
    `api_server._live_turn_snapshot()`. Tests: `tests/test_voice_journal_privacy.py`,
    `tests/test_vault_log_privacy.py`, `tests/test_live_transcript.py`.
16. **Uploaded documents are screened before indexing; high-tier PII goes to the
    Vault and a locked Vault means nothing is indexed.** `api_server.knowledge_upload()`
    with `ingestion.screen_text_for_pii()`. Tests: `tests/test_vault_encryption.py`
    (`test_unexpected_store_error_refuses_and_never_indexes`).

**Extension and state**

17. **A skill runs only in the bubblewrap jail, reaches out only through its own
    digest-bound switch, and installs only behind three gates.** `skills/sandbox.py`,
    `skills/broker.py`, `skills/install.py`. Tests: `tests/test_skills_sandbox.py`,
    `tests/test_skills_broker.py`, `tests/test_skills_install.py`.
18. **Runtime state goes under the state root, never the code tree.**
    `config.resolve_state_dir()`, `statedir.py`. Tests: `tests/test_statedir.py`,
    `tests/test_statedir_call_sites.py`.
19. **No credential is read at import time in tests or scripts.** Test:
    `tests/test_secret_hygiene.py`.

## 6. Conventions

- **Tests with every change.** A fix comes with the test that would have caught it.
  A new gate comes with a test that proves it refuses. Test names describe the
  behaviour (`test_shut_switch_refuses_before_dns`), never a ticket.
- **Comments and docstrings say what the code does and why, in the present tense.**
  Keep the security reasoning, ordering constraints and invariants. Do not record
  history, dates, ticket ids, who asked for what, or anything about a particular
  household.
- **Style.** PEP 8, type hints on new functions, a docstring on anything public.
  Match the surrounding file's voice and density. Do not reformat code you did not
  otherwise change. TypeScript must pass `npx tsc --noEmit`.
- **Fail closed.** A gate that cannot decide refuses. A privacy check that throws
  withholds. An unreadable consent file is not consent.
- **Honest refusal text.** When a switch is off, show the `user_message` from
  `EgressBlocked` (or the row's `settings_hint`). Say which switch and where it
  lives. Never answer as if the lookup happened.
- **Words.** The Bridge is open or closed; each way out has a switch. Refer to the
  security agent as Drawbridge in user-facing text (internal id `sentinel`).
- **Where docs live.** Operator and design docs in `docs/`. `docs/WHAT_CAN_LEAVE_YOUR_HOUSE.md`
  is generated from the registry: never edit it by hand, run
  `python scripts/gen_egress_doc.py`. A new setting or environment variable goes
  into `docs/CONFIG.md` in the same change.
- **Commits.** `type(scope): subject` (see [`CONTRIBUTING.md`](CONTRIBUTING.md)).
  Install `scripts/precommit-secret-scan.sh` as a pre-commit hook.

## 7. How to extend it

### A new assistant tool
1. Add an `@tool` function inside `AssistantTools.create_tools()` in
   `src/puffpai/assistant_tools.py`. The docstring is what the model reads: say when
   to call it and what it returns. Names are unique.
2. Declare it in `capability_registry.py`: as the `authority_tool` of a capability
   or in its `also_tools`, with `keywords` that bind it to queries.
3. If it can return vault content, add its name to `VAULT_PRIVATE_TOOLS`.
4. If it reaches the internet, use a Bridge entry (see the last subsection) and
   return the refusal text on `EgressBlocked`.
5. If a fixed phrasing should be answered with no model at all, add a `_try_*`
   helper called from `_try_instant_answer()` in `api_server.py`, in the right
   place in its chain. Do not widen `_detect_route()` for this.
6. If it changes the house, it belongs behind an agent intent, not a bare tool
   call (next subsections).
7. Tests: the tool's own behaviour, its registry binding (`tools_for_query`),
   and `tests/test_qa_codebase_audit.py` (no duplicate names, descriptions present).

### A capability registry entry
1. Add a `Capability(...)` to `CAPABILITIES`: a stable `id` (`domain.thing`),
   exactly one `authority_tool` (or `"(none)"` with `status=PLANNED`), the real
   `data_source`, `access`, owning `agent` from the roster, `surfaces`.
2. `dispatch_phrases` only for phrasings that can mean nothing but "run this read
   now". Leave it empty otherwise.
3. If the capability needs a Bridge switch, map it in `_DOMAIN_DOORS`,
   `_CAPABILITY_DOORS` or `_SOURCE_DOORS` so introspection says it is off.
4. `capability_registry.validate(tool_names)` must return no new problems.

### An app
1. Create `apps/<id>/app.json` with `"schema": "puffpai_app/v1"`. An app is data
   only: nothing in it is imported, evaluated or fed to the model as text. Bounds
   are in `app_registry.py` (keywords, examples, actions, default data size).
2. Declare every outbound host in the manifest's `doors` list with `purpose` and
   `data_sent_plain`; each block becomes its own shut switch (`app:<id>:<n>`).
   An empty `hosts` list means the app reaches nothing.
3. Default data goes in `data.default`; data lives in `app_data/<id>.json` under
   the state root and is written only through `security/app_data_store.write_json_secure`.
4. Add a pack entry in `packs/homebot/pack.json` if it ships with the build; call
   `POST /apps/rescan` to reload.
5. Tests: the app-manifest contract tests and the manifest-switch tests (grep
   `puffpai_app/v1` and `register_app_doors` under `tests/`), for example
   `test_every_shipped_app_registers_a_namespaced_door_that_is_shut`.

### A skill
1. Start from `src/puffpai/skills_examples/iss_position/`: `manifest.json`
   (`puffpai_skill/v1`), `skill.py` with `run(inputs, ctx)`, `tests_fixtures.json`.
2. The only way out is `ctx.fetch_json` / `ctx.fetch_text` to hosts listed in
   `permissions.network_hosts`. No imports of the appliance, no files, no environment.
3. `skill.py` fits the consent card (200 lines, 16 KB). Triggers that collide with
   any existing capability are refused by `skills/manifest.py`.
4. Skills are staged as drafts and installed only after the owner approves the exact
   bytes. Never write into `<state>/skills/` directly.
5. Tests: `tests/test_skills_manifest.py`, `tests/test_skills_e2e.py` (with
   `tests/skillkit.py`).

### A knowledge pack
0. [`docs/KNOWLEDGE_PACKS.md`](docs/KNOWLEDGE_PACKS.md) lists every pack this build can read, with its
   official download, size and license; `python -m puffpai.knowledge.pack_catalog` prints the
   same list from `config/capability_catalog.json` and `config/source_registry.json`. A new pack
   gets a row in both files and a line in the document; `tests/test_knowledge_pack_catalog.py`
   checks that they agree. No pack file ships with the repository.
1. Put the `.zim` file in a directory listed in `paths.zim_dirs`.
2. Build its full-text shard: `python -m puffpai.knowledge.fts_build_cli --zim-dir <dir> --fts-dir <dir>`.
3. It appears at `GET /knowledge/libraries`. No network is involved. Do not add
   `kiwix-serve`, `libzim` or any GPL reader; `knowledge/zim_reader.py` is the reader.
4. Documents a person uploads take the screened path (contract 16), never a direct
   write into ChromaDB.

### An agent behaviour
1. Implement the intent in the owning agent's `handle()`. Agents talk only through
   `self.ask(to, envelope)`; never import another agent's instance.
2. If it changes state: add it to that module's `STATE_CHANGING_INTENTS`, refuse it
   unless `envelope.state_changing` is true, and make sure `collect_targets()` in
   `sentinel_agent.py` sees what it touches.
3. If it must never run without a person: add it to `CONFIRM_REQUIRED_INTENTS`
   (Steward) or rely on `ha_bridge.SAFETY_CRITICAL_DOMAINS`.
4. If the planner may use it: add a spec in `planning_loop` (`_PLAN_SPECS`, which
   builds `CATALOGUE`) with its `cap_id`; if the router may resolve to it, add it
   to `concierge.RESOLVABLE_INTENTS`. Otherwise list it with a reason in
   `UNDECLARED_ON_PURPOSE` in `tests/test_capability_contract.py`.
5. Secrets only through `self.secret(name)`. Widening `_SCOPE_ALLOW` is a security
   change and needs a stated reason.
6. Tests: `tests/test_capability_contract.py`, `tests/test_planner_registry_contract.py`,
   `tests/test_agent_team.py`, plus the behaviour itself.

### An outbound connection
1. Add a `Door(...)` row to `DOORS` in `security/egress_doors.py`: `id`, exact
   lower-case `hosts`, `purpose`, `data_sent` written for a person, `config_flag`,
   `env_var` (`PUFFPAI_EGRESS_<ID>`), `consent_kind`, `enforcement="registry"`,
   `third_party` when it is a company's service, a `settings_hint` that says "off"
   and where to switch it on. `default` stays `False`.
2. Make the call with `egress_get(door_id, url)` or `egress_request(...)`. Catch
   `EgressBlocked` and surface its `user_message`.
3. Regenerate `docs/WHAT_CAN_LEAVE_YOUR_HOUSE.md` (`python scripts/gen_egress_doc.py`)
   and add the variable to `docs/CONFIG.md`.
4. If a capability depends on it, map it in the registry (see above).
5. Tests: shut refuses without a socket (use the no-socket fixture), an undeclared
   host is refused, the call site names its entry (`test_call_site_is_wired_to_its_door`).
6. A call that genuinely stays inside the house uses `security/lan_http.py`
   (`lan_get` / `lan_post`) and gets a one-line reason in the call-site test's
   allowlist. A public host there is the exact mistake the test exists to catch.

## 8. Never do this

- Add a network call (Python, Node or a container) that is not registered with the
  Bridge, or add a public host to the LAN allowlist to make a test pass.
- Ship a switch, overlay value or config default that is on.
- Read a secret with `os.getenv` or from a file outside `security/secrets_provider.py`,
  the Vault, or the unit's `EnvironmentFile`; log a secret, a PIN or a vault value.
- Bypass pairing, the proxy allowlist, the API-key hook, the Drawbridge veto, a
  consent request or a human confirmation. Do not add a route to `_PUBLIC_ENDPOINTS`
  or `LOCAL_ONLY_ENDPOINTS` without a written justification and its test.
- Trust `X-Puff-Device-Id`, `X-Forwarded-For` or any client header for identity;
  relay a new client header through the dashboard proxy without a scoped rule.
- Add telemetry, analytics, crash reporting, update checks or any call home.
- Write runtime state into `src/` or `/opt/puffpai`; the unit runs
  `ProtectSystem=strict` and a package-relative path fails silently there.
- Feed app manifests, skill text or fetched web pages to the model as instructions.
- Back code execution with Docker (the docker group is root-equivalent); the jail is
  bubblewrap.
- Delete or weaken a test to make a failure go away. Put the owner's household
  details, real names, addresses or network layout into code, tests or docs.

Further reading: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`SECURITY.md`](SECURITY.md),
[`docs/WHAT_CAN_LEAVE_YOUR_HOUSE.md`](docs/WHAT_CAN_LEAVE_YOUR_HOUSE.md),
[`docs/CONFIG.md`](docs/CONFIG.md), [`docs/INSTALL_ORIN.md`](docs/INSTALL_ORIN.md),
[`docs/ZONE3_SETUP.md`](docs/ZONE3_SETUP.md), [`docs/KIOSK_MODE.md`](docs/KIOSK_MODE.md),
[`docs/VOICE_DUCKING.md`](docs/VOICE_DUCKING.md), [`docs/DEVICE_SENTINEL.md`](docs/DEVICE_SENTINEL.md),
[`CONTRIBUTING.md`](CONTRIBUTING.md).
