# Hardware

Founders Edition targets one machine: the NVIDIA Jetson AGX Orin. Everything in
"tested reference" below was actually run on the reference appliance. Anything
not listed there has not been tried by us, whatever the spec sheet says.

| Component | Required / optional | Tested reference | Notes |
|---|---|---|---|
| **Jetson AGX Orin, 64 GB** | required | AGX Orin 64 GB developer kit | `scripts/provision_orin.sh:153` prints RAM and states "the model plan assumes 64 GB". The four pinned models are ~39 GB of weights (`scripts/provision_orin.sh:422-426`); the chat and planner models alone are 13.8 + 18.6 GB, and `docs/INSTALLATION.md` records that below 32 GB of RAM they will not co-reside and the box swaps. 16 GB is the hard floor the installer enforces, and it is slow. |
| **NVMe SSD** | required | 1 TB NVMe mounted at `/data` | The provisioner refuses to continue below 80 GB free (`PUFFPAI_MIN_FREE_GB`, `scripts/provision_orin.sh:37,103`) and warns when no NVMe device is present: the dev kit's 64 GB eMMC cannot hold models + ChromaDB + ZIM packs (`scripts/provision_orin.sh:155-159`). Ollama's model directory is moved onto it by `systemd/ollama.service.d/override.conf:16`. |
| **USB mic array** | optional (required for voice) | **ReSpeaker XVF3800** | The only capture device the voice pipeline was tuned against; it is simultaneously the Pulse sink and the mic, which is why ducking works the way it does (`systemd/user/puffpai-voice.service.d/10-duck.conf:28`). Selected by name, not index, via `PUFF_CAPTURE_DEVICE` (`src/puffpai/voice/capture.py`); `alsa-utils` is installed so `arecord -l` can find it (`scripts/provision_orin.sh:167-193`). |
| **Speaker** | optional (required for voice) | the XVF3800's own output | Any PulseAudio sink. Pulse owns the hardware mixer, so volume is set through Pulse and never `amixer` (`systemd/puffpai-api.service.d/10-pulse-volume.conf`). Sink chosen with `PUFF_SINK` / `PUFFPAI_PULSE_SINK`. USB or 3.5 mm both work in principle; only the reference chain was run. |
| **Home Assistant** | optional (required for smart home) | HAOS on a separate host on the LAN | The code assumes a reachable HA base URL plus a long-lived token: `config/home_assistant_config.json.example` ships `{"enabled", "url", "token"}` and nothing else. Container or separate box both satisfy that; it is never installed on the appliance by our scripts. |
| **Zigbee coordinator** | optional | paired through Home Assistant's ZHA | PuffPAI drives pairing through HA, not through a radio of its own (`src/puffpai/zigbee_pairing.py`, `zigbee_manager.py`). Any coordinator ZHA supports is a candidate; ours was exercised only through ZHA. |
| **Display for kiosk** | optional | one HDMI monitor on the Orin | `scripts/provision_kiosk.sh` auto-logs in and runs Chromium full-screen at `KIOSK_URL` (`kiosk/kiosk.env.example`), with a night-blanking window. Read `docs/KIOSK_MODE.md` first: an ordinary desktop browser left on the animated dashboard can pin the GPU at 99% and trip over-current protection. |
| **UPS** | optional | none | Not tested, not integrated, no code path. Zone 3 becomes the house's DNS resolver once the router points at it, so a power cut there takes name resolution with it (`systemd/puffpai-zone3.service:6-10`), that is the argument for one. |
| **x86_64 machine** | n/a | not tested for the appliance | `scripts/provision_orin.sh:95-98` accepts `x86_64` or `aarch64`, and the Node-RED image is multi-arch, but the Founders Edition reference build is the Orin. For other hardware use the wizard in `CypherSisters/HomeBotBuild`. |

## Power

The Orin's power mode matters for inference sizing. `scripts/install_ubuntu.sh:216`
reports `nvpmodel -q` during preflight and refuses to treat a box with no
`nvpmodel` as a complete JetPack install. The reference appliance runs capped:
`src/puffpai/inference/model_options.py:172` records that the planner context
size is a measured choice "on a box pinned at MODE_50W". Nothing in the repo
sets the mode for you, set it yourself with `nvpmodel -m` before benchmarking.

## Storage layout

`/data` is where the NVMe goes. `scripts/provision_orin.sh` builds
`/data/puffpai/{models,knowledge,network,config,logs,chat_history,app_data,chromadb,home}`
plus `vault/` at mode `0700`, and `models/ollama` owned by the `ollama` user.
Partitioning and mounting the NVMe is deliberately not automated, do it by
hand, first.
