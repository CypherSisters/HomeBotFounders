"""The offline knowledge packs this build can read, and where each one comes from.

Reads ``config/capability_catalog.json`` (one ``knowledge_pack`` row per pack)
and ``config/source_registry.json`` (one download row per file). Nothing here
downloads anything and no pack ships with the repository: the list tells a
person which file to fetch, from where, how big it is and what its license
allows. A downloaded ``.zim`` goes in a directory listed in ``paths.zim_dirs``.

A pack is listed as available only when its row says ``"available": true``,
carries a license, and every one of its ``source_ids`` names an https download
row that also carries a license. Anything else is left out and logged, so the
list never offers a pack it cannot point at.

Usage::

    python -m puffpai.knowledge.pack_catalog

Copyright (c) Cypher Sisters. Apache-2.0 License.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any, Optional

logger = logging.getLogger(__name__)

CATALOG_SCHEMA = "capability_catalog/v2"
REGISTRY_SCHEMA = "source_registry/v1"

PACK_FIELDS = ("id", "label", "domain", "tags", "available", "size_mb",
               "license", "license_url", "license_checked", "commercial_use",
               "what_it_is", "source_ids")


def config_dir() -> str:
    """The shipped ``config/`` directory of this checkout."""
    from puffpai.config import get_config
    return os.path.join(get_config().REPO_ROOT, "config")


def _read(path: str) -> Optional[dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Knowledge pack list unreadable at %s: %s", path, exc)
        return None
    return data if isinstance(data, dict) else None


def _download_problem(row: Any) -> Optional[str]:
    if not isinstance(row, dict):
        return "no download row"
    if not str(row.get("license") or "").strip():
        return "download row has no license"
    if not str(row.get("source_url") or "").startswith("https://"):
        return "download address is not https"
    return None


def load_packs(catalog_path: Optional[str] = None,
               registry_path: Optional[str] = None) -> list[dict[str, Any]]:
    """Every available pack, each with its download rows attached. Never raises.

    Each pack is the catalog row plus a ``downloads`` list holding the matching
    registry rows, in ``source_ids`` order.
    """
    base = None if catalog_path and registry_path else config_dir()
    catalog = _read(catalog_path or os.path.join(base, "capability_catalog.json"))
    registry = _read(registry_path or os.path.join(base, "source_registry.json"))
    if not catalog or not registry:
        return []
    rows = {str(r.get("id")): r for r in registry.get("sources") or []
            if isinstance(r, dict)}

    packs: list[dict[str, Any]] = []
    for item in catalog.get("items") or []:
        if not isinstance(item, dict) or item.get("kind") != "knowledge_pack":
            continue
        ident = item.get("id") or "<unnamed>"
        missing = [f for f in PACK_FIELDS if item.get(f) is None]
        if missing:
            logger.warning("Knowledge pack %s left out: missing %s", ident, ", ".join(missing))
            continue
        if item.get("available") is not True:
            continue
        downloads = []
        problem = None
        for source_id in item.get("source_ids") or []:
            row = rows.get(str(source_id))
            problem = _download_problem(row)
            if problem:
                problem = f"{source_id}: {problem}"
                break
            downloads.append(dict(row))
        if problem or not downloads:
            logger.warning("Knowledge pack %s left out: %s", ident, problem or "no source_ids")
            continue
        pack = dict(item)
        pack["downloads"] = downloads
        packs.append(pack)
    return packs


def _size_phrase(size_mb: Any) -> str:
    try:
        value = float(size_mb)
    except (TypeError, ValueError):
        return "size unknown"
    if value >= 1024:
        return f"about {value / 1024:.1f} GB"
    return f"about {value:.0f} MB"


def summary_lines(packs: list[dict[str, Any]]) -> list[str]:
    """Plain lines for a person: name, size, license, and where to get it."""
    if not packs:
        return ["No knowledge packs are listed."]
    lines = [f"{len(packs)} knowledge packs are available to download:"]
    for pack in packs:
        terms = str(pack.get("license"))
        if not pack.get("commercial_use"):
            terms += ", personal use only"
        if not pack.get("license_checked"):
            terms += ", license not confirmed"
        lines.append(f"  - {pack.get('label')} ({_size_phrase(pack.get('size_mb'))}, {terms})")
        lines.append(f"      {pack.get('what_it_is')}")
        for row in pack["downloads"]:
            lines.append(f"      From: {row.get('source_url')}")
    return lines


def main(argv: Optional[list[str]] = None) -> int:
    for line in summary_lines(load_packs()):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
