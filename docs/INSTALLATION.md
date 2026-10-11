# Installation

The appliance install lives in **[INSTALL_ORIN.md](INSTALL_ORIN.md)**, OS
layer, power mode, directories, models, dashboard, units, containers, voice,
Home Assistant, kiosk. Hardware: [HARDWARE.md](HARDWARE.md). Settings:
[CONFIG.md](CONFIG.md).

This page keeps only the development setup.

---

## Windows development setup (dev only)

Windows is a **development** environment. The appliance is Linux, and nothing
here produces a running appliance: no systemd units, no Node-RED, no voice
service, no kiosk.

```powershell
# Python 3.10+, Git and Ollama for Windows must be installed first.
ollama pull gpt-oss:20b
ollama pull nomic-embed-text

git clone https://github.com/CypherSisters/HomeBotFounders.git
cd HomeBotFounders

py -m venv venv
.\venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt

py start_api.py          # serves :8000
```

The relative `paths.*` defaults in `config/puffpai_config.json` are fine when
you run from a checkout you own, they only break under the appliance's
read-only `/opt`.

The dashboard runs separately:

```powershell
cd dashboard
npm install
npm run dev              # :3003
```

Tests: `python -m pytest -q tests`.
