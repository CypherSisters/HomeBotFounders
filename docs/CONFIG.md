# Configuration reference

Everything the runtime reads: config files first, then environment variables by
family. Defaults are the values in the code, not the values on any particular
box. No setting here carries a value from a real home.

## Config files

| File | Read by | Notes |
|---|---|---|
| `config/puffpai_config.json` | `src/puffpai/config.py` | The main file: `ollama`, `nodered`, `chromadb`, `api_server`, `nabu`, `identity`, `models`, `paths`, `zone3`. Ships **relative** `paths.*` values, which fail under the systemd unit's read-only `/opt`. Make every one absolute under `/data/puffpai` before first start (`systemd/puffpai-api.service:94-98`). |
| `config/home_assistant_config.json` | `src/puffpai/ha_bridge.py`, `security/ha_token_source.py` | Copy from `config/home_assistant_config.json.example`: `{"enabled", "url", "token"}`. The long-lived token belongs in the Vault; the plaintext key here is the fallback, disabled by `systemd/puffpai-api.service.d/20-ha-token-failclosed.conf` once the migration has run. |
| `config/indexed_libraries.json` (template) | `api_server.py` | Seeded from `config/indexed_libraries.json.template`. `src/puffpai/indexed_libraries.json` is untracked and seeded with `[]` by `scripts/provision_orin.sh`. |
| `config/pulse/puffpai-socket.pa` | PulseAudio | Appended to the session's `default.pa` so the sandboxed API can reach a Pulse socket at `/data/puffpai/state/pulse.sock`. |
| `config/zone3/AdGuardHome.seed.yaml` | `scripts/zone3_bootstrap_adguard.py` | Seed policy: query log on, protection **off**. |
| `searxng/config/settings.yml` | the SearXNG container | Copy from `settings.yml.example` and generate `secret_key` on the box (`openssl rand -hex 32`). Never commit or print the real file. |
| `kiosk/kiosk.env` → `/etc/puffpai/kiosk.env` | `kiosk/kiosk-session.sh` | `KIOSK_URL`, `DISPLAY_OFF`, `DISPLAY_ON`. Installed by `scripts/provision_kiosk.sh`, never clobbered. |
| `/etc/puffpai/api.env` | `systemd/puffpai-api.service` (`EnvironmentFile`) | Backend secrets: `PUFFPAI_API_KEY`, `HA_TOKEN`. `0640 root:puffpai`. |
| `/etc/puffpai/dashboard.env` | `systemd/puffpai-dashboard.service` | Dashboard server-side config (below). |
| `/opt/puffpai/.env` | `docker-compose.nodered.yml` via compose | Flow secrets: `PUFFPAI_API_KEY`, `HA_TOKEN`, `JELLYFIN_API_KEY`. Git-ignored, must be `0600` (`systemd/puffpai-nodered.service:32-34`). |
| `$PUFFPAI_DATA_DIR/state/egress_doors.json` | `security/egress_doors.py` | The Bridge switch overlay written from Settings > Egress. Outranks the config file, never the environment. Unreadable overlay = every switch shut. |

## Grocery vendor (FreshTable)

No store ships with the appliance: a shipped store link would say where the
household shops, and a default would say it for everyone. The grocery order
draft is item + quantity only until these two are set in
`config/puffpai_config.json`; `app_data.py` reads them defensively, so a config
without them is the normal, vendor-free case.

| Key | Meaning | Default |
|---|---|---|
| `grocery_store_name` | Display name of the store the draft is addressed to. Empty = the draft names no store. | `""` |
| `grocery_search_url` | Search-URL template for one item; `{q}` is replaced with the URL-encoded item name (e.g. `https://example-market.com/search?q={q}`). Empty = the draft carries no links. | `""` |

The link is a URL a person clicks in their own browser. The appliance never
fetches it, so nothing crosses the Bridge.

## Location (`config/puffpai_config.json`)

No location ships with the appliance. Until a home point or coordinates are
set, the weather card says the location is not set and a severe-weather
question says so too, never another city's forecast.

The usual way to set it is the **Home point** card in Settings: paste
`lat, lon` once. It is stored 0600 in the data dir
(`$PUFFPAI_DATA_DIR/config/home_point.json`), layered over the config file at
load, and never shown back or logged (`GET /api/home-point` answers only
whether one is set). Directions, the weather card and the alerts all read it.

| Key | Meaning | Default |
|---|---|---|
| `location` | Place name used in replies (e.g. `"Springfield, IL"`). Not geocoded. | `""` |
| `latitude`, `longitude` | Decimal degrees for the weather card (open-meteo) and severe-weather alerts (NWS), used when no home point is saved. Both must be set and in range, otherwise both are treated as unset (as is exactly `0, 0`). | `null` |
| `maps.valhalla_url`, `maps.photon_url` | The two offline map engines (loopback only; any other host is refused). | `http://127.0.0.1:8002`, `http://127.0.0.1:2322` |
| `maps.meta_path` | The active map build's `META.json` (data date shown with directions). | `/data/puffpai/maps/current/META.json` |

The Node-RED weather flows have their own `WEATHER_DEFAULT_LAT` /
`WEATHER_DEFAULT_LON` (see `nodered_flows/README.md`).

## Home Assistant events (`ha_events` in `config/puffpai_config.json`)

| Key | Meaning | Default |
|---|---|---|
| `enabled` | Run the read-only WebSocket listener that feeds state changes to the agent team. | `true` |
| `watch_entities` | fnmatch globs of the entities to forward, e.g. `["binary_sensor.front_door_person", "binary_sensor.*_motion"]`. Empty = the listener does not start. | `[]` |
| `debounce_seconds` | Per-entity cool-down between forwarded events. | `30` |

## Books (`media_server` in `config/puffpai_config.json`)

| Key | Meaning | Default |
|---|---|---|
| `calibre_db_path` | Calibre's `metadata.db`, the catalogue the librarian reads. | `/mnt/media/books/metadata.db` |
| `calibre_web_db_path` | Calibre-Web's own database. Shelves live here, so a shelf made by voice is the one the web reader shows. | `/data/puffpai/calibre-web/app.db` |
| `books_popularity_path` | Offline popularity file for recommendations, built from the Project Gutenberg catalogue. Absent means random within the category. | `/data/puffpai/knowledge/gutenberg_catalog/popularity.json` |

## Core environment

| Variable | Meaning | Default |
|---|---|---|
| `PUFFPAI_DATA_DIR` | Writable state root for everything resolved through `config.resolve_state_dir()`. Set to `/data/puffpai/state` by the unit. | repo-relative `data/` |
| `PUFFPAI_LOG_LEVEL` | Level for the `puffpai` logger tree (`start_api.py:20`). | `INFO` |
| `PUFFPAI_API_KEY` | Bearer key for the backend. Resolved vault → OS keyring → env (`api_server.py:616`). | unset (gate refuses to start unprovisioned) |
| `PUFFPAI_PROVISION_API_KEY` | One-shot: writes the key into the OS keyring on first boot, then unset it. | unset |
| `PUFFPAI_OLLAMA_URL` | Override the Ollama base URL (`config.py:41`). | `http://127.0.0.1:11434` |
| `OLLAMA_URL` | Same override, read by the Caretaker agent's health check. | config value |
| `PORT` | Overrides `api_server.port` for the module entry point. Note `start_api.py` hardcodes `0.0.0.0:8000` and ignores both. | `8000` |
| `HA_TOKEN` | Home Assistant long-lived token, env fallback for the secrets provider. | unset |
| `PUFFPAI_ALLOW_PLAINTEXT_HA_TOKEN_FALLBACK` | `0` fails the HA token closed instead of reading it from the plaintext config. | on (fallback allowed) |
| `PUFFPAI_SEARXNG_TIMEOUT` | Seconds for a SearXNG query (`config.py:45`). | config value |
| `PUFFPAI_RAG_UPLOAD_RELEVANCE_MIN` | Minimum relevance for an uploaded-document hit to be used. | code default |
| `CREDENTIALS_DIRECTORY` | Set by systemd `LoadCredential`; where the vault service key is read from. | unset |
| `JOURNAL_STREAM` | Set by systemd; tells the logger it is running under journald. | unset |

## Feature switches

| Variable | Meaning | Default |
|---|---|---|
| `PUFFPAI_AGENT_TEAM_ENABLED` | Agent team and its event log. | `1` |
| `PUFFPAI_SCHEDULER` | Background scheduler thread. | `1` |
| `PUFFPAI_SENTINEL_ENABLED` | Device Sentinel LAN scanning. | `0` |
| `PUFFPAI_FIREWALL_BACKEND` | Opts a Linux host into a real per-device write backend (`nft`/`nftables`, which also needs `CAP_NET_ADMIN`). No host packet filter ships with this release, so anything else means PuffPAI refuses to block and says so. | unset (refuses) |
| `PUFFPAI_ENFORCE_CONSENT` | Consent gate enforcement. | `0` |
| `PUFFPAI_MAX_BLAST_RADIUS` | Maximum entities one gated action may touch. | `10` |
| `PUFFPAI_MULTIUSER` | Per-user household views. | off |
| `PUFFPAI_SCRUB_AND_VAULT` | Automatic PII scrub into the Vault. | off |
| `PUFFPAI_NOTIFY_SERVICE` | HA notify service used for agent notifications. | unset |
| `PUFFPAI_SNOOZE_MINUTES` | Alarm snooze length. | `9` |
| `PUFFPAI_RADIO_IMAGE` | Container image for the radio player. | `puffpai-radio:latest` |

## Bridge switches (egress)

One variable per switch, all read by `security/egress_doors.py`. Environment is
the highest-precedence source: a switch forced shut here cannot be opened from
the UI. Every switch defaults to **shut**.

`PUFFPAI_EGRESS_WEATHER`, `PUFFPAI_EGRESS_AIR_QUALITY`,
`PUFFPAI_EGRESS_NEWS_RSS`, `PUFFPAI_EGRESS_GEOCODE`, `PUFFPAI_EGRESS_GEOIP`,
`PUFFPAI_EGRESS_RADIO_BROWSER`, `PUFFPAI_EGRESS_TUNEIN`, `PUFFPAI_EGRESS_WEB_SEARCH`,
`PUFFPAI_EGRESS_WEB_FETCH`, `PUFFPAI_EGRESS_PAGE_READER`,
`PUFFPAI_EGRESS_CONNECTIVITY_PROBE`, `PUFFPAI_EGRESS_SPOTIFY`,
`PUFFPAI_EGRESS_TV_FREE_CHANNELS`, `PUFFPAI_EGRESS_MAP_DATA_UPDATES`. Full descriptions of what leaves through each:
[`WHAT_CAN_LEAVE_YOUR_HOUSE.md`](WHAT_CAN_LEAVE_YOUR_HOUSE.md).

## Offline maps (`deploy/maps/`)

Read by `puffpai.maps_refresh` and `deploy/maps/refresh.sh`. The build ships
a Texas example region; to build another region, see "Map region" in
[`deploy/maps/RUNBOOK.md`](../deploy/maps/RUNBOOK.md) (`PHOTON_REGION_ISO`,
`PHOTON_MIN_PLACES`, `SMOKE_FROM`, `SMOKE_TO`, `SMOKE_SEARCHES`).

| Variable | Meaning | Default |
|---|---|---|
| `PUFFPAI_HOME` | Install root `refresh.sh` runs from. | `/opt/puffpai` |
| `PUFFPAI_MAPS_ROOT` | Where map releases live. | `/data/puffpai/maps` |
| `PUFFPAI_MAPS_DEPLOY_DIR` | Where the build and activate scripts live. | `$PUFFPAI_HOME/deploy/maps` |
| `PUFFPAI_MAPS_DOWNLOADS` | Staging folder for refresh downloads. | `$PUFFPAI_MAPS_ROOT/downloads` |
| `PUFFPAI_MAPS_SERVICE_ENV_FILE` | The service env file the refresh job reads `PUFFPAI_EGRESS_MAP_DATA_UPDATES` from; missing or unreadable counts as forced shut. | `/etc/puffpai/api.env` |

## TV cast and the kiosk TV player

| Variable | Meaning | Default |
|---|---|---|
| `PUFFPAI_TV_CAST_LAN_CIDR` | Pins the network a cast target must be on. Unset: a private IPv4 address in the same /24 as the box address that reaches it. | unset |
| `PUFFPAI_TV_CAST_PORT` | Port the TV fetches `/cast/<id>/` from. | `8000` |
| `PUFFPAI_TV_CAST_JELLYFIN_FILE` | The `tv-cast` Jellyfin user's credential file. | `config/tv_cast_jellyfin.json` |
| `PUFFPAI_TV_CAST_STATE_DIR` | Cast state (active casts, linked TVs). | `$PUFFPAI_DATA_DIR/tv_cast` |
| `PUFFPAI_TV_CAST_PUBLIC_M3U` | Playlist of the free internet channels (used only with `tv_free_channels` open). | `/data/puffpai/jellyfin/config/livetv/iptv-unreliable.m3u` |
| `PUFFPAI_TVPLAYER_IMAGE` | Container image for the native full-screen player (`docker/tvplayer/`). | `puffpai-tvplayer:1` |
| `PUFFPAI_TVPLAYER_MEDIA_CONFIG` | Media server config the player reads its Jellyfin address from. | `/opt/puffpai/config/media_server_config.json` |
| `PUFFPAI_TVPLAYER_FREE_M3U` | Free-channel playlist for the player. | as `PUFFPAI_TV_CAST_PUBLIC_M3U` |
| `PUFFPAI_TVPLAYER_CACHE` | Player cache folder. | `/data/puffpai/tvplayer/cache` |
| `PUFFPAI_KIOSK_DISPLAY`, `PUFFPAI_KIOSK_XAUTHORITY` | The kiosk X display the player draws on. | `:0`, `/run/user/1000/gdm/Xauthority` |

## Audio

| Variable | Meaning | Default |
|---|---|---|
| `PUFFPAI_PULSE_SINK` | Sink the volume lever drives. | `@DEFAULT_SINK@` |
| `PUFFPAI_PULSE_SOCKET` | Explicit Pulse socket path for the sandboxed service. | unset |
| `PUFFPAI_PULSE_RUNTIME_DIR` | Pulse runtime dir when no socket is given. | `/run/user/1000` |

## Voice (`systemd/user/puffpai-voice.service` and its drop-ins)

Speech-to-text and playback: `PUFF_STT_ENGINE` (`whisper`),
`PUFF_WHISPER_MODEL` (`base.en`), `PUFF_WHISPER_DEVICE` (`cpu`),
`PUFF_WHISPER_COMPUTE` (`int8`), `PUFF_VOSK_MODEL`, `PUFF_PIPER_MODEL`,
`PUFF_CAPTURE_DEVICE` (`pulse`), `PUFF_SINK` (empty = default sink),
`PUFF_BRAIN_URL` (`http://127.0.0.1:8000/api/chat`).

Wake word: `PUFF_WAKE_MODEL`, `PUFF_WAKE_THRESHOLD` (`0.6`), `PUFF_WAKE_GATE`
(`150`), `PUFF_WAKE_CONFIRM` (`1`), `PUFF_WAKE_CONFIRM_HOTWORDS`,
`PUFF_WAKE_CONFIRM_WINDOW` (`1.2`), `PUFF_WAKE_COOLDOWN` (`1.5`),
`PUFF_WAKE_NEARMISS` (`0.4`), `PUFF_WAKE_RETRY_WINDOW` (`12`),
`PUFF_WAKE_BRIDGE_MAX` (`4.0`), `PUFF_WAKE_MAX_GAIN` (`25`),
`PUFF_WAKE_TARGET_PEAK` (`29491`).

Endpointing: `PUFF_VAD_THRESHOLD` (`100`), `PUFF_VAD_MARGIN` (`80`),
`PUFF_VAD_CALIBRATE` (`1`), `PUFF_VAD_CALIBRATE_SECONDS` (`0.3`),
`PUFF_VAD_CALIBRATE_MAX` (`400`), `PUFF_SILENCE_HANG` (`1.0`),
`PUFF_FRAGMENT_EXTEND` (`1.5`), `PUFF_MAX_UTTERANCE_CONFIRMED` (`20.0`),
`PUFF_MAX_UTTERANCE_UNCONFIRMED` (`6.0`), `PUFF_MAX_UTTERANCE` (override both),
`PUFF_STT_MAX_GAIN` (`20`), `PUFF_STT_WEAK_LOGPROB` (`-0.8`).

Turn taking: `PUFF_BARGE_IN` (`1`), `PUFF_BARGE_IN_AFTER` (`3.0`),
`PUFF_BARGE_IN_COOLDOWN` (`1.5`), `PUFF_BARGE_IN_MAX_RESTARTS` (`2`),
`PUFF_FOLLOWUP` (`0`), `PUFF_FOLLOWUP_WINDOW` (`8.0`), `PUFF_MAX_FOLLOWUPS`
(`3`), `PUFF_HISTORY_TURNS` (`6`), `PUFF_ANNOUNCE` (`1`), `PUFF_ANNOUNCE_POLL`
(`2`), `PUFF_START_TIMEOUT` (`6.0`), `PUFF_CAPTURE_STALL_TIMEOUT` (`15`),
`PUFF_CAPTURE_MAX_REOPEN` (`2`).

Ducking (`docs/VOICE_DUCKING.md`): `PUFF_DUCK_ADDRESSED_LEVEL`,
`PUFF_DUCK_PEEK_LEVEL` (`70`), `PUFF_DUCK_PEEK_ARM` (`20`), `PUFF_DUCK_PCT`
(`45`), `PUFF_DUCK_ON_LISTEN` (`0`).

Stop while it speaks (`POST /voice/stop` is the control-channel twin):
`PUFF_TTS_INTERRUPT` (`1`), `PUFF_TTS_INTERRUPT_RMS` (`180`),
`PUFF_TTS_INTERRUPT_FACTOR` (`2.0`), `PUFF_TTS_SELFRMS_FACTOR` (`1.6`),
`PUFF_TTS_INTERRUPT_GRACE` (`0.4`), `PUFF_TTS_INTERRUPT_CAPTURE` (`0.9`),
`PUFF_TTS_INTERRUPT_PREROLL` (`0.3`), `PUFF_TTS_INTERRUPT_SILENCE` (`0.25`),
`PUFF_TTS_INTERRUPT_RUN` (`0.2`), `PUFF_TTS_INTERRUPT_COOLDOWN` (`0.6`),
`PUFF_TTS_INTERRUPT_MAX_WORDS` (`5`), `PUFF_VOICE_CONTROL_POLL` (`0.1`).
"Stop" over music with no wake word: `PUFF_MEDIA_STOP_WORDS` (`5`),
`PUFF_MEDIA_STOP_RMS` (`250`), `PUFF_MEDIA_STOP_CONF` (`-0.8`).

Wake-name confirm, second pass (only when `PUFF_WAKE_CONFIRM=1`; the shipped
unit sets `0`): `PUFF_WAKE_CONFIRM_MIN_CONF` (`-0.75`),
`PUFF_WAKE_CONFIRM_FLOOR` (`-1.0`), `PUFF_WAKE_CONFIRM_PASS1_WORDS` (`4`),
`PUFF_WAKE_CONFIRM_PASS2_WORDS` (`6`), `PUFF_WAKE_TAIL_WORDS` (`4`),
`PUFF_WAKE_SHAPED_MIN_WORDS` (`3`), `PUFF_WAKE_SHAPED_MAX_WORDS` (`5`),
`PUFF_FUZZY_ADDRESS_WORDS` (`6`), `PUFF_JUNK_GUARD_WORDS` (`3`).

Follow-ups without the wake word (only when `PUFF_FOLLOWUP=1`):
`PUFF_FOLLOWUP_MODE` (`request`: acted on only if it sounds like a request),
`PUFF_FOLLOWUP_MIN_CONF` (`-0.8`), `PUFF_FOLLOWUP_MAX_CHAIN` (`3` turns before
the name is needed again). Ducking: `PUFF_DUCK_PEEK_HOLD` (`4` seconds).

Spoken replies, read by the backend: `PUFF_VOICE_MAX_SENTENCES` (`2`),
`PUFF_VOICE_MAX_SPOKEN_WORDS` (`45`), `PUFF_VOICE_THINK` (`0`; `1` lets the
model reason before a spoken reply, which delays the first word).

Logging: `PUFF_LOG_TRANSCRIPTS` (`0`; turning it on writes what was said to
disk), `PUFF_VOICE_LOG_MAX_BYTES` (2 MB), `PUFF_VOICE_LOG_BACKUPS` (`2`).
`PUFF_VAULT_CHALLENGE_TTL` (`300` seconds): how long after a vault challenge
the voice journal withholds whatever is said next, in case it is the PIN.

## Dashboard

Server-side, from `/etc/puffpai/dashboard.env`. None of these are inlined into
the browser bundle.

| Variable | Meaning |
|---|---|
| `PUFFPAI_API_URL` / `PUFFPAI_BACKEND_URL` | Backend base URL for the `/api/pai` proxy |
| `PUFFPAI_API_KEY` | Bearer key the proxy injects |
| `HA_BASE_URL`, `HA_ACCESS_TOKEN` | Home Assistant proxy |
| `JELLYFIN_LAN_HOST`, `JELLYFIN_LAN_IP`, `JELLYFIN_PROXY_PORT` | Loopback media proxy in `instrumentation.ts` (listens on `JELLYFIN_PROXY_PORT`, default 8096). `JELLYFIN_LAN_HOST` has no default: the proxy stays off until it is set to a plain hostname or IPv4 address, and the page CSP names `http://<host>:8096` only when it is. `JELLYFIN_LAN_IP` is the retry address and falls back to the host. |
| `CALIBRE_LAN_HOST`, `CALIBRE_PROXY_PORT` | Loopback books proxy in `instrumentation.ts` (listens on `CALIBRE_PROXY_PORT`, default 8083). `CALIBRE_LAN_HOST` has no default: the proxy stays off until it is set. |
| `OLLAMA_HOST` | Ollama address for dashboard-side model views |
| `PUFF_PAIRING_ENFORCE` | Pairing gate mode (`all` enforces on every route) |
| `PUFF_PAIRED_DEVICES`, `PUFF_DEVICE_TOKENS`, `PUFF_PAIRING_STATE` | Pairing store locations |
| `PUFF_TRUST_PROXY` | Trust `X-Forwarded-For` when behind a reverse proxy |
| `NEXT_RUNTIME` | Set by Next.js; selects the instrumentation path |

Build-time, from `dashboard/.env.production` (copy the `.example`). Next.js
inlines `NEXT_PUBLIC_*` into the client bundle, so a secret here is a published
secret.

| Variable | Default |
|---|---|
| `NEXT_PUBLIC_API_URL` | `/api/pai` |
| `NEXT_PUBLIC_APP_NAME` | `PuffPAI` |
| `NEXT_PUBLIC_VERSION` | `1.0.0` |
| `NEXT_PUBLIC_JELLYFIN_URL` | unset |
