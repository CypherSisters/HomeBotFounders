"""The knowledge pack list: every pack is listed, available and sourced.

``config/capability_catalog.json`` names each offline knowledge pack and
``config/source_registry.json`` names where each one is downloaded from.
These tests keep the two files honest with each other and with
``docs/KNOWLEDGE_PACKS.md``, and pin what the reader leaves out.

Copyright (c) Cypher Sisters. Apache-2.0 License.
"""
from __future__ import annotations

import json
import os
import re

import pytest

from puffpai.knowledge import pack_catalog

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "config", "capability_catalog.json")
REGISTRY = os.path.join(ROOT, "config", "source_registry.json")
DOC = os.path.join(ROOT, "docs", "KNOWLEDGE_PACKS.md")


def _load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture(scope="module")
def catalog():
    data = _load(CATALOG)
    assert data["schema"] == pack_catalog.CATALOG_SCHEMA
    return data


@pytest.fixture(scope="module")
def registry():
    data = _load(REGISTRY)
    assert data["schema"] == pack_catalog.REGISTRY_SCHEMA
    return data


@pytest.fixture(scope="module")
def rows(registry):
    return {r["id"]: r for r in registry["sources"]}


@pytest.fixture(scope="module")
def raw_packs(catalog):
    return [i for i in catalog["items"] if i.get("kind") == "knowledge_pack"]


@pytest.fixture(scope="module")
def packs():
    return pack_catalog.load_packs(CATALOG, REGISTRY)


def test_every_listed_pack_loads_as_available(raw_packs, packs):
    assert len(raw_packs) >= 66
    assert [p["id"] for p in packs] == [p["id"] for p in raw_packs]
    assert all(p["available"] is True for p in packs)


def test_pack_ids_are_unique(raw_packs):
    ids = [p["id"] for p in raw_packs]
    assert len(ids) == len(set(ids))


def test_registry_ids_and_urls_are_unique(registry):
    ids = [r["id"] for r in registry["sources"]]
    urls = [r["source_url"] for r in registry["sources"]]
    assert len(ids) == len(set(ids))
    assert len(urls) == len(set(urls))


def test_every_pack_row_carries_the_required_fields(raw_packs):
    for pack in raw_packs:
        missing = [f for f in pack_catalog.PACK_FIELDS if pack.get(f) in (None, "", [])
                   and not isinstance(pack.get(f), bool)]
        assert not missing, f"{pack['id']} is missing {missing}"
        assert isinstance(pack["license_checked"], bool), pack["id"]
        assert isinstance(pack["commercial_use"], bool), pack["id"]
        assert float(pack["size_mb"]) > 0, pack["id"]
        assert pack["license_url"].startswith("https://"), pack["id"]
        assert all(t == t.lower() for t in pack["tags"]), pack["id"]


def test_every_download_row_is_licensed_https_and_sized(rows):
    for row in rows.values():
        assert row["license"].strip(), row["id"]
        assert row["license_url"].startswith("https://"), row["id"]
        assert row["source_url"].startswith("https://"), row["id"]
        assert float(row["size_mb"]) > 0, row["id"]


def test_pack_facts_match_their_download_rows(packs):
    for pack in packs:
        downloads = pack["downloads"]
        assert [d["id"] for d in downloads] == pack["source_ids"], pack["id"]
        assert pack["size_mb"] == sum(int(d["size_mb"]) for d in downloads), pack["id"]
        for row in downloads:
            assert row["license"] in pack["license"], pack["id"]
            if not row.get("commercial_use"):
                assert pack["commercial_use"] is False, pack["id"]


def test_non_commercial_and_no_derivatives_licenses_say_so(rows):
    for row in rows.values():
        if re.search(r"-NC\b|-NC-", str(row.get("license"))):
            assert row["commercial_use"] is False, row["id"]


def test_an_unchecked_license_is_never_offered_for_commercial_use(rows, raw_packs):
    for row in rows.values():
        if row.get("license_checked") is False:
            assert row["commercial_use"] is False, row["id"]
    for pack in raw_packs:
        if pack["license_checked"] is False:
            assert pack["commercial_use"] is False, pack["id"]


def test_downloads_use_the_undated_kiwix_name(rows):
    for row in rows.values():
        assert row["source_url"] == "https://download.kiwix.org/zim/" + row["filename"], row["id"]
        assert not re.search(r"_\d{4}-\d{2}\.zim$", row["filename"]), row["id"]
        if row.get("known_good"):
            assert re.search(r"_\d{4}-\d{2}\.zim$", row["known_good"]), row["id"]


def test_the_pack_list_document_names_every_pack(packs):
    with open(DOC, encoding="utf-8") as fh:
        text = fh.read()
    for pack in packs:
        for row in pack["downloads"]:
            name = row["filename"][:-len(".zim")]
            assert name in text, f"{pack['id']} ({name}) is not in KNOWLEDGE_PACKS.md"


def test_summary_names_size_terms_and_address(packs):
    lines = pack_catalog.summary_lines(packs)
    assert lines[0].startswith(f"{len(packs)} knowledge packs")
    text = "\n".join(lines)
    assert "From: https://download.kiwix.org/zim/" in text
    assert "personal use only" in text
    assert "license not confirmed" in text


def _write(tmp_path, items, sources):
    cat = tmp_path / "catalog.json"
    reg = tmp_path / "registry.json"
    cat.write_text(json.dumps({"schema": pack_catalog.CATALOG_SCHEMA, "items": items}),
                   encoding="utf-8")
    reg.write_text(json.dumps({"schema": pack_catalog.REGISTRY_SCHEMA, "sources": sources}),
                   encoding="utf-8")
    return str(cat), str(reg)


def _pack(**overrides):
    row = {"id": "pack:x", "kind": "knowledge_pack", "label": "X", "domain": "reference",
           "tags": ["x"], "available": True, "size_mb": 1, "license": "CC-BY-SA-4.0",
           "license_url": "https://example.org/l", "license_checked": True,
           "commercial_use": True, "what_it_is": "X.", "source_ids": ["src_x"]}
    row.update(overrides)
    return row


def _source(**overrides):
    row = {"id": "src_x", "license": "CC-BY-SA-4.0", "source_url": "https://example.org/x.zim",
           "size_mb": 1}
    row.update(overrides)
    return row


def test_a_pack_whose_download_is_missing_is_left_out(tmp_path):
    cat, reg = _write(tmp_path, [_pack(source_ids=["nowhere"])], [_source()])
    assert pack_catalog.load_packs(cat, reg) == []


def test_a_download_without_a_license_or_https_is_left_out(tmp_path):
    cat, reg = _write(tmp_path, [_pack()], [_source(license="")])
    assert pack_catalog.load_packs(cat, reg) == []
    cat, reg = _write(tmp_path, [_pack()], [_source(source_url="http://example.org/x.zim")])
    assert pack_catalog.load_packs(cat, reg) == []


def test_a_pack_not_marked_available_is_left_out(tmp_path):
    cat, reg = _write(tmp_path, [_pack(available=False)], [_source()])
    assert pack_catalog.load_packs(cat, reg) == []


def test_an_unreadable_list_yields_no_packs(tmp_path):
    missing = str(tmp_path / "absent.json")
    assert pack_catalog.load_packs(missing, missing) == []
    assert pack_catalog.summary_lines([]) == ["No knowledge packs are listed."]


def test_the_shipped_list_loads_through_the_config_root():
    ids = {p["id"] for p in pack_catalog.load_packs()}
    assert {"pack:wikipedia", "pack:gutenberg", "pack:ted_water"} <= ids
