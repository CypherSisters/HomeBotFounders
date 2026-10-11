"""CONTRIBUTING.md must tell a contributor to sync with `main`.

This repo's upstream branch is `main`; the guard below is cheap and standing.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CONTRIBUTING = REPO_ROOT / "CONTRIBUTING.md"


def test_contributing_exists():
    assert CONTRIBUTING.exists()


def test_the_sync_block_pushes_to_main():
    text = CONTRIBUTING.read_text(encoding="utf-8").replace("\r\n", "\n")
    assert "git checkout main" in text
    assert "git pull upstream main" in text
    assert "git push origin main" in text


def test_the_pr_checklist_names_main():
    text = CONTRIBUTING.read_text(encoding="utf-8")
    assert "Branch is up to date with `main`" in text
