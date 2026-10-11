---
name: Bug report
about: Something is broken or behaving unexpectedly
title: "[BUG] "
labels: bug
assignees: ''
---

<!-- Security problem? Do not file it here: use private vulnerability
     reporting (see SECURITY.md). Before pasting anything below, take out the
     API key, tokens, PINs and anything personal (names, addresses, your
     network). -->

## What happened

<!-- What did you expect, and what did you get instead? -->

## Steps to reproduce

1.
2.
3.

## Journal excerpt

<!-- `journalctl -u puffpai-api -n 100 --no-pager` (or the unit that failed:
     puffpai-dashboard, puffpai-nodered, ollama), trimmed to the lines around
     the failure. For an install problem, paste the installer's output,
     including any `VERIFY FAILURE(S)` block. -->

```
paste here
```

## `/system/status` output (optional)

<!-- On the Orin: `curl -s -H "X-API-Key: <your key>" http://127.0.0.1:8000/system/status`
     (the key is in /etc/puffpai/api.env). REDACT any secret field before
     pasting. -->

```
paste here, secrets REDACTED
```

## Hardware

<!-- Jetson AGX Orin model and RAM, JetPack (`cat /etc/nv_tegra_release`),
     NVMe size, mic and speaker if this is about voice. -->

## Commit

<!-- `git rev-parse --short HEAD` in the checkout you installed from. -->

## Anything else

<!-- Screenshots, or context that would help. -->
