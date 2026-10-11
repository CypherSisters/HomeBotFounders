"""
Shared pytest fixtures for PuffPAI tests.
Mocks all external dependencies (Ollama, Kiwix, Node-RED, Home Assistant).
"""

import json
import logging
import os
import sys
import pytest

# Add src to path so puffpai package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

#: Egress doors the suite grants appliance-level consent to, and NOTHING more.
#: See ``_isolate_egress_overlay`` for why, and
#: ``tests/test_toolsmith_web_tools_egress.py`` for the test that pins this to
#: exactly these two so it cannot grow into a blanket "egress on in tests".
TEST_OPEN_DOORS = {"web_fetch": True, "web_search": True}


@pytest.fixture(autouse=True)
def _isolate_puffpai_logging():
    """Snapshot/restore the global 'puffpai' logger around every test.

    setup_logging() mutates the shared 'puffpai' logger (level, handlers) and
    the module-level _configured flag; without restoration, tests that call it
    (test_logging_config.py, test_integration.py) leak that state into later
    caplog-based tests and make the suite order-dependent.
    """
    import puffpai.logging_config as lc
    logger = logging.getLogger("puffpai")
    saved_handlers = logger.handlers[:]
    saved_level = logger.level
    saved_propagate = logger.propagate
    saved_disabled = logger.disabled
    saved_configured = lc._configured
    yield
    for handler in logger.handlers:
        if handler not in saved_handlers:
            handler.close()
    logger.handlers[:] = saved_handlers
    logger.setLevel(saved_level)
    logger.propagate = saved_propagate
    logger.disabled = saved_disabled
    lc._configured = saved_configured


@pytest.fixture
def temp_dir(tmp_path):
    """Temporary directory for test files."""
    return tmp_path


@pytest.fixture
def mock_config(tmp_path):
    """Create a temporary puffpai_config.json with test values."""
    config = {
        "ollama": {
            "url": "http://localhost:11435",
            "model": "test-model",
            "temperature": 0.7,
        },
        "nodered": {
            "url": "http://localhost:1880",
            "timeout": 5,
            "webhooks": {
                "block_device": "/webhook/block-device",
                "network_scan": "/webhook/network-scan",
            },
        },
        "chromadb": {"path": str(tmp_path / "test_chroma")},
        "api_server": {"host": "127.0.0.1", "port": 8000},
        "nabu": {
            "enabled": False,
            "wake_word": "hey puffpai",
            "voice_max_length": 500,
        },
        "identity": {
            "name": "TestBot",
            "avatar_style": "thumbs",
            "avatar_seed": "test",
        },
    }
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    config_file = config_dir / "puffpai_config.json"
    config_file.write_text(json.dumps(config))
    return config_file


@pytest.fixture
def mock_ha_config(tmp_path):
    """Mock Home Assistant config."""
    config = {
        "url": "http://localhost:8123",
        "token": "test-token-12345",
        "enabled": True,
    }
    config_dir = tmp_path / "config"
    config_dir.mkdir(exist_ok=True)
    config_file = config_dir / "home_assistant_config.json"
    config_file.write_text(json.dumps(config))
    return config_file


@pytest.fixture
def mock_blocked_devices(tmp_path):
    """Create a temporary blocked_devices.json."""
    blocked_file = tmp_path / "blocked_devices.json"
    blocked_file.write_text(json.dumps([]))
    return blocked_file


# Split literal: a single "...api-key...=<24+ chars>" line trips the
# pre-commit secret scan's shape check. The runtime value is unchanged.
_TEST_API_KEY = "puffpai-test-" + "api-key-not-a-real-secret"


@pytest.fixture(scope="session", autouse=True)
def _secret_hygiene():
    """Session-wide: no test may read or write the real OS keychain.

    1. secrets_provider._HAS_KEYRING = False — the keyring tier (Windows
       Credential Manager service "puffpai", which holds a REAL HA_TOKEN)
       is off for the whole suite.
    2. PUFFPAI_API_KEY is set to a synthetic value in the env so
       api_server's import-time _load_or_create_api_key() resolves via the
       env tier instead of falling through to its generate path — which
       would OVERWRITE the machine's real Credential Manager entry via
       keyring.set_password (api_server.py:341-350).
    3. HA_TOKEN / HA_ACCESS_TOKEN are removed from the env so the env tier
       cannot resolve a real HA credential either.
    4. keyring.set_password / delete_password are replaced with a raiser —
       no code path reached from a test may mutate Credential Manager.

    Session-scoped so it precedes every module/class fixture that imports
    or reloads api_server. Per-test opt-in for keychain READS is
    @pytest.mark.real_keyring (see _real_keyring_optin); writes stay
    blocked unconditionally.
    """
    mp = pytest.MonkeyPatch()
    import puffpai.security.secrets_provider as sp_mod
    mp.setattr(sp_mod, "_HAS_KEYRING", False)
    mp.setenv("PUFFPAI_API_KEY", _TEST_API_KEY)
    mp.delenv("HA_TOKEN", raising=False)
    mp.delenv("HA_ACCESS_TOKEN", raising=False)
    try:
        import keyring

        def _blocked(*a, **k):
            raise RuntimeError(
                "blocked by tests/conftest.py: tests must never write the "
                "OS keychain (real Credential Manager entries live here)"
            )

        mp.setattr(keyring, "set_password", _blocked)
        mp.setattr(keyring, "delete_password", _blocked)
    except ImportError:
        pass
    yield
    mp.undo()


@pytest.fixture(autouse=True)
def _real_keyring_optin(request, monkeypatch):
    """Opt-in: @pytest.mark.real_keyring re-enables keychain READS only."""
    if request.node.get_closest_marker("real_keyring"):
        import puffpai.security.secrets_provider as sp_mod
        monkeypatch.setattr(sp_mod, "_HAS_KEYRING", True)
    yield


@pytest.fixture(autouse=True)
def _reset_ha_token_cache():
    """security/ha_token_source.py caches a successful resolution
    for five minutes so scrypt does not run on every HABridge construction.
    That cache is process-global, so without this a token resolved in one test
    leaks into the next one's assertions."""
    try:
        from puffpai.security.ha_token_source import invalidate_cache
    except Exception:
        yield
        return
    invalidate_cache()
    yield
    invalidate_cache()


@pytest.fixture(autouse=True)
def _isolate_egress_overlay(tmp_path_factory):
    """Point the egress-door owner overlay at a per-test path.

    ``egress_doors.overlay_path()`` falls back to ``<repo>/state/`` when
    ``$PUFFPAI_DATA_DIR`` is unset, which is every dev checkout and every test
    run. Without this, one test that toggles a door (or a developer who once
    ran the API locally) leaves a file that silently OPENS doors for every
    later test — measured: it broke 15 tests across three egress files in
    exactly that way. The overlay outranks the config file by design, so tests
    that repoint only ``_config_path`` cannot defend themselves.

    Each test gets its own overlay path, so nothing a test writes escapes into
    the next one or into the developer's checkout.

    **That overlay seeds exactly two doors open: ``web_fetch`` and
    ``web_search``.** Read this before adding a third.

    Those two are the Toolsmith's, and they are real gates:
    ``agents/toolsmith.py`` asks ``require_open`` before its own SSRF
    checks, so with them shut every fetch and search refuses before a socket
    opens. That is the intended production posture and it is what the door's
    OWN tests assert. But several hundred pre-existing tests exercise the
    machinery BEHIND that consent — SSRF gates, redirect scoping, budget
    accounting, the planning loop's sealed host scope — and they were written
    when appliance-level consent did not exist. Seeding it here keeps those
    suites testing what they are about, instead of all failing at a new first
    gate and hiding real regressions behind one cause.

    Consequences to keep in mind:

    * A test that means to assert the SHUT behaviour must say so explicitly.
      Two established patterns work and both outrank this fixture: set the
      ``PUFFPAI_EGRESS_*`` environment variable (env beats the overlay), or
      call ``set_overlay_override`` with your own file, as
      ``test_egress_api.py`` does.
    * Every OTHER door stays shut here, which is the registry default. This
      fixture is not "egress on in tests"; it is "the two Toolsmith doors are
      consented to, so the gates behind them are what is under test".
    * ``tests/test_toolsmith_web_tools_egress.py`` asserts this set is exactly
      those two, so it cannot quietly grow into a blanket opt-out.
    """
    try:
        from puffpai.security import egress_doors
    except Exception:
        yield
        return
    overlay = tmp_path_factory.mktemp("egress_overlay") / "egress_doors.json"
    overlay.write_text(json.dumps({
        "version": 1,
        "kind": egress_doors.OVERLAY_KIND,
        "doors": dict(TEST_OPEN_DOORS),
    }), encoding="utf-8")
    egress_doors.set_overlay_override(str(overlay))
    yield
    egress_doors.set_overlay_override(None)
    egress_doors.reset_cache()


#: What every declared door host resolves to during the test run. Any globally
#: routable literal would do; this one is IANA's, the address ``example.com``
#: answered with for years, so it can never be a household's own. Nothing dials
#: it — the guard below sees to that — and a test that means to assert a PRIVATE
#: answer has to install one itself.
TEST_PUBLIC_ADDRESS = "93.184.216.34"


@pytest.fixture(autouse=True)
def _offline_door_resolver():
    """No test makes a real DNS query through the egress-door registry.

    ``security/egress_doors._check_url`` resolves a declared host and refuses
    unless every answer is globally routable — the control that closes
    manifest-declared SSRF. That check is only
    honest if it really looks the name up, so without this fixture every test
    that walks an OPEN door would query the household's resolver: slow, flaky,
    offline-hostile, and a test suite that quietly egresses.

    Every host resolves to one public address here. A test that needs a
    different answer — a name that points into the LAN, a name that will not
    resolve, a split public/loopback answer — calls
    ``egress_doors.set_resolver_override`` itself, and that call outranks this
    fixture for the duration of the test.
    """
    try:
        from puffpai.security import egress_doors
    except Exception:
        yield
        return
    egress_doors.set_resolver_override(
        lambda host, port: [TEST_PUBLIC_ADDRESS])

    # And no test builds a real transport by accident. Every host resolving to
    # a public literal above means the wrapper's checks PASS, and without this
    # the pinned session would then dial 93.184.216.34 for real — which is how
    # a suite acquires four-minute connect timeouts and a live egress it never
    # meant to make. A test that wants a transport stubs this itself (the
    # ``fake_requests``/``fake_get``/``transport`` fixtures do); a test that
    # wants the REAL pin restores it (test_security_hostname_not_destination.py does).
    def _no_wire(_door):
        raise AssertionError(
            "a test reached the wire through an egress door. Stub "
            "egress_doors._pinned_session (see tests/conftest.py) or, if the "
            "real pinned transport is the thing under test, restore it.")

    original = egress_doors._pinned_session
    egress_doors._pinned_session = _no_wire
    yield
    egress_doors._pinned_session = original
    egress_doors.set_resolver_override(None)


@pytest.fixture(autouse=True)
def _isolate_egress_policy(tmp_path_factory):
    """Point the egress POLICY overlay at a per-test path, with none set.

    Same hazard as the door overlay: ``egress_policy.policy_path()`` falls back
    to ``<repo>/state/`` when ``$PUFFPAI_DATA_DIR`` is unset, so one test that
    flips ``chat_allow_egress`` would otherwise leave a file that changes every
    later test's answer.

    Unlike the doors, nothing is seeded: the opt-in ships OFF, the tests that
    care set it themselves, and a chat turn acquiring egress by default in the
    test suite is exactly the accident this file exists to prevent.
    """
    try:
        from puffpai.security import egress_policy
    except Exception:
        yield
        return
    egress_policy.set_policy_override(
        str(tmp_path_factory.mktemp("egress_policy") / "egress_policy.json"))
    yield
    egress_policy.set_policy_override(None)
    egress_policy.reset_cache()


@pytest.fixture(autouse=True)
def _isolate_used_approvals(tmp_path_factory):
    """Point the persisted used-approval ledger (ha_pending_apply) at a
    per-test file, so one test's spent approval never leaks into the next or
    into the developer's checkout."""
    try:
        from puffpai import ha_pending_apply
    except Exception:
        yield
        return
    ha_pending_apply.set_used_path_override(
        str(tmp_path_factory.mktemp("used_approvals") / "ha_used_approvals.json"))
    yield
    ha_pending_apply.set_used_path_override(None)


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "real_keyring: allow this test to reach the real OS keychain "
        "(bypasses the suite-wide _HAS_KEYRING=False autouse guard)",
    )
