# Zone 3, Network Edge Security Setup

Zone 3 is the boundary between your home and the internet. It runs AdGuard
Home on the appliance as a DNS sinkhole that can block smart-device telemetry,
ads and tracking at the network level. It ships inert: nothing points at it,
and protection is off in the seeded configuration.

## Prerequisites

- The appliance installed (`docs/INSTALL_ORIN.md`)
- Docker on the appliance, and `PUFFPAI_BIND_IP` (the box's LAN IPv4) in
  `/opt/puffpai/.env`; `scripts/install_orin.sh` writes it

## Step 1: Start AdGuard Home

Either pass `--with-zone3` to `scripts/install_orin.sh`, or follow the Zone 3
part of step 9 in `docs/INSTALL_ORIN.md`:

```bash
sudo install -D -m 0644 systemd/puffpai-zone3.service /etc/systemd/system/puffpai-zone3.service
sudo systemctl daemon-reload && sudo systemctl enable --now puffpai-zone3
sudo /opt/puffpai/venv/bin/python /opt/puffpai/scripts/zone3_bootstrap_adguard.py
```

The bootstrap generates an admin credential into `config/.zone3.env` (mode
`0600`, never printed), completes AdGuard's first-run wizard, turns the query
log on and protection **off**, and loads the PuffPAI rule block. It is
idempotent.

Verify it is running:

```bash
docker ps | grep puffpai-adguard
```

AdGuard admin UI: `http://<box>:3000` (and `http://127.0.0.1:3000` on the box).

## Step 2: Enable Zone 3 in PuffPAI

Edit `config/puffpai_config.json`:

```json
"zone3": {
    "enabled": true,
    "adguard_url": "http://127.0.0.1:3000",
    "adguard_username": "puffpai",
    "adguard_enforce": false,
    "auto_discover": true,
    "default_mode": "balanced"
}
```

Give the API the admin password as `ADGUARD_PASSWORD` through the secrets
provider (`python scripts/store_secret.py ADGUARD_PASSWORD`), not in this file.
`adguard_enforce: false` keeps Zone 3 monitor-first: rules are recorded and
visible, nothing is blocked. Set it to `true` only after you have read the
query log.

## Step 3: Test Safely (No Router Changes)

Zone 3 does NOT require changing your router's DNS. Traffic from devices you
leave alone stays untouched. Three safe testing options:

### Option A: Test on one computer first

Set one computer's DNS server to the appliance's LAN address and browse
normally. This lets you verify blocking before touching any other device.

### Option B: Target specific smart devices only

For WiFi-connected smart devices, you can set their DNS individually:
- Smart TVs: Settings > Network > DNS > Manual > enter the appliance's IP
- IoT hubs (Hue Bridge, etc.): Usually configurable via their app
- Some devices: Set a static IP + DNS in your router's DHCP reservations

Devices you DON'T change keep using the router's default DNS. Game consoles,
work laptops and everything else are unaffected.

### Option C: Full network (when ready)

Only when you're confident, point the router's DNS at the appliance.
See "Full Network Deployment" at the bottom of this guide.

## Step 4: Initialize the Zone 3 Rules

One-time setup, writes the PuffPAI rules for the discovered devices:

```bash
curl -X POST http://localhost:8000/zone3/setup \
  -H "Authorization: Bearer $PUFFPAI_API_KEY"
```

That first call answers **409 with a proposal**, not an error: it tells you how
many rules across how many devices it is about to write, and whether Zone 3 is
enforcing (they take effect at once) or observing (they are written commented
out). To go ahead, mint a ticket and present it back:

```bash
TICKET=$(curl -s -X POST http://localhost:8000/zone3/confirm \
  -H "Authorization: Bearer $PUFFPAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"kind":"zone3_setup","target":"zone3","action":"sync"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["ticket"])')

curl -X POST http://localhost:8000/zone3/setup \
  -H "Authorization: Bearer $PUFFPAI_API_KEY" -H "Content-Type: application/json" \
  -d "{\"ticket\": \"$TICKET\"}"
```

The ticket is single-use, bound to that one act, and expires in 90 seconds.

Or via PuffPAI chat: *"Set up Zone 3"*, she will show you the proposal and
stop. Confirming is yours; no tool call can mint the ticket.

## Step 5: Discover and Secure Devices

Via PuffPAI chat:
- *"What devices are on my network?"*
- *"Secure my smart devices"*
- *"Show me Zone 3 status"*

Via API. Reads need only the API key; **every write needs a ticket** minted at
`POST /zone3/confirm` (see Step 4). Calling a write without one returns 409 and
a plain-language proposal of exactly what would change, that is the supported
way to preview it.

```bash
# Discover devices (read-only)
curl -H "Authorization: Bearer $PUFFPAI_API_KEY" \
  http://localhost:8000/zone3/discover

# Auto-secure a device        kind: zone3_secure  target: <ip>  action: secure
curl -X POST http://localhost:8000/zone3/secure \
  -H "Authorization: Bearer $PUFFPAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"ip": "192.168.50.50", "mac": "50:01:BB:AA:CC:DD", "ticket": "..."}'

# Change a device's security mode   kind: zone3_mode  target: <ip>  action: <mode>
curl -X PUT http://localhost:8000/zone3/device/192.168.50.50/mode \
  -H "Authorization: Bearer $PUFFPAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"mode": "lockdown", "ticket": "..."}'

# Stop managing a device      kind: zone3_remove  target: <ip>  action: remove
# (the ticket may ride X-Zone3-Ticket instead, since DELETE bodies are awkward)
curl -X DELETE http://localhost:8000/zone3/device/192.168.50.50 \
  -H "Authorization: Bearer $PUFFPAI_API_KEY" -H "X-Zone3-Ticket: ..."
```

## Security Modes

| Mode | What it blocks | Device impact |
|------|---------------|---------------|
| **LOCKDOWN** | ALL known outbound domains (telemetry + ads + cloud) | Cloud features stop working. Maximum privacy. |
| **BALANCED** | Telemetry, ads, and tracking. Allows cloud services. | Device works normally. No spying. |
| **OPEN** | Ads and cross-device tracking only. | Full functionality. Minimal blocking. |
| **ALWAYS_ALLOW** | Nothing. Safety-critical devices only. | Medical devices, fire alarms, never blocked. |

## Default Mode Assignments

| Device Type | Default Mode | Why |
|------------|-------------|-----|
| IoT Camera (Ring, Wyze) | LOCKDOWN | Cameras should not phone home |
| Printer | LOCKDOWN | No reason for internet access |
| Unknown device | LOCKDOWN | Deny by default |
| Smart Speaker (Echo, Google) | BALANCED | Needs cloud for voice, but stop tracking |
| Smart TV (Roku, Samsung) | BALANCED | Needs streaming, block telemetry |
| IoT Appliance (Hue, Ecobee) | BALANCED | Needs cloud API, block analytics |
| Computer | OPEN | User's primary device |
| Phone / Tablet | OPEN | User's primary device |
| Gaming Console | OPEN | Needs online services |
| Medical Device | ALWAYS_ALLOW | Never block, safety critical |
| Fire/CO Alarm | ALWAYS_ALLOW | Never block, safety critical |
| Router / AP | ALWAYS_ALLOW | Blocking breaks your network |

## Troubleshooting

### DNS not working after setup
- Verify the container is running and healthy: `docker ps`
- Check its logs: `docker logs puffpai-adguard`
- Check the query log in the AdGuard admin UI

### Devices not resolving DNS
- Ensure the device (or your router) points at the appliance's LAN address
- Devices may need to renew DHCP: disconnect/reconnect WiFi
- If the appliance's LAN address changed, set `ZONE3_BIND_IP` (or
  `PUFFPAI_BIND_IP`) in `/opt/puffpai/.env` and restart `puffpai-zone3`

## Device Identification

Zone 3 identifies devices using multiple signals, in priority order:

1. **Home Assistant**, If HA manages the device, PuffPAI uses HA's
   friendly name (e.g., "Living Room TV", "Kitchen Echo")
2. **Zone 3 managed list**, Previously classified devices are remembered
3. **MAC OUI lookup**, Identifies manufacturer from MAC address prefix
   (Samsung, Amazon, Google, Ring, etc.)
4. **Hostname patterns**, Matches hostnames like "iphone", "roku", etc.
5. **mDNS / SSDP**, Network service discovery protocols

If a device shows as "Unknown", you can manually classify it in the
dashboard or in chat: *"The device at 192.168.50.50 is my smart fridge"*

## Full Network Deployment (Optional)

Only when you're ready to protect ALL devices:

1. Find the appliance's LAN address: `ip -4 addr` (or `PUFFPAI_BIND_IP` in
   `/opt/puffpai/.env`)
2. Open your router's admin panel
3. Set **Primary DNS** to the appliance's LAN address
4. Save and reboot the router

Every device now resolves through the appliance, so a power cut or reboot of
the appliance takes name resolution with it. A secondary DNS server avoids
that, but devices then bypass the sinkhole whenever they choose the secondary.

### Common Router Brands

- **NETGEAR**: Advanced > Setup > Internet Setup > DNS Address
- **TP-Link**: Advanced > Network > DHCP Server > Primary DNS
- **Linksys**: Connectivity > Local Network > DHCP Server
- **Xfinity/Comcast**: Gateway > Connection > WiFi > Edit > DNS
- **Google Wifi/Nest**: Settings > Network > Advanced > DNS (Custom)
- **Eero**: Settings > Network Settings > DNS > Custom DNS
