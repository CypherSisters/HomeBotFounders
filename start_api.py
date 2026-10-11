"""PuffPAI backend entrypoint — the one systemd (puffpai-api.service) runs.

Logging is configured HERE because this is the only entrypoint on the Linux
appliance path. ``puffpai.service.run_service()`` calls ``setup_logging()`` for
the Windows scheduled-task path only. Without the call below the ``puffpai``
logger has level NOTSET and zero handlers, so every ``logger.info()`` in the
backend is discarded and only WARNING+ escapes via ``logging.lastResort``. Werkzeug access lines still show
up in journald because werkzeug configures its own logger.
"""

import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

_REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_STATE_DIR = os.path.join(_REPO_ROOT, "data")

#: Overrides the default INFO level, e.g. Environment=PUFFPAI_LOG_LEVEL=DEBUG.
_LEVEL_ENV = "PUFFPAI_LOG_LEVEL"


def _resolve_log_dir() -> str:
    """Directory for the rotating log file, under the WRITABLE state root.

    Must go through :func:`puffpai.config.resolve_state_dir` like every other
    module that writes state. The unit runs ProtectSystem=strict with
    ReadWritePaths=/data/puffpai, so a package-relative path here would fail
    with EROFS on the appliance while looking fine in a dev checkout, and the
    writes would be lost silently.
    """
    try:
        from puffpai.config import get_config, resolve_state_dir
        cfg = get_config()
        state_dir = resolve_state_dir(
            cfg.paths.state_dir,
            repo_root=cfg.REPO_ROOT,
            default=_DEFAULT_STATE_DIR,
        )
    except Exception:
        # Logging must never be what stops the service booting, and this runs
        # before any handler exists, so there is nowhere to report it yet.
        state_dir = os.environ.get(
            "PUFFPAI_DATA_DIR", "").strip() or _DEFAULT_STATE_DIR
    return os.path.join(state_dir, "logs")


def _restrict(path: str, mode: int) -> None:
    """Best-effort tighten of permissions; never fatal.

    The log is not a transcript-free file: INFO carries LLM reply fragments,
    uploaded filenames and HA device names, so it should not be world-readable
    even though /data/puffpai is already 0750. A no-op on Windows, where chmod
    only toggles the read-only bit.
    """
    try:
        os.chmod(path, mode)
    except OSError:
        pass


def configure_logging():
    """Attach console + rotating-file handlers to the ``puffpai`` logger.

    Returns the log file path actually configured, or None if only the console
    handler could be set up (unwritable directory — the service still runs and
    journald still receives everything).
    """
    from puffpai.logging_config import setup_logging

    level = os.environ.get(_LEVEL_ENV, "").strip() or "INFO"

    log_file = None
    log_dir = _resolve_log_dir()
    try:
        os.makedirs(log_dir, exist_ok=True)
        _restrict(log_dir, 0o750)
        log_file = os.path.join(log_dir, "puffpai.log")
    except OSError:
        # setup_logging() degrades to console-only; stderr goes to journald,
        # so we lose the on-disk copy but not the diagnostics.
        pass

    setup_logging(level=level, log_file=log_file)

    # setup_logging() swallows a file-handler failure to keep the console
    # alive, so confirm rather than assume the file is really there before
    # reporting it. Rotated copies inherit their mode from the unit's UMask,
    # which is why puffpai-api.service sets it too — this chmod covers only
    # the file we just created (and the dev case, which has no unit).
    if log_file and os.path.exists(log_file):
        _restrict(log_file, 0o640)
    else:
        log_file = None
    return log_file


def main():
    log_file = configure_logging()

    from puffpai.logging_config import get_logger
    logger = get_logger(__name__)
    logger.info(
        "PuffPAI API starting (log level %s, file %s)",
        os.environ.get(_LEVEL_ENV, "").strip() or "INFO",
        log_file or "disabled",
    )

    from puffpai.api_server import app, start_background_services
    start_background_services()  # Sentinel + warm-up + chat history

    # Bind address. Default stays 0.0.0.0 because an OFF-BOX Home Assistant
    # (the usual deployment) has to reach the conversation endpoints, and
    # every route but /health is behind the API key.
    #
    # Set PUFFPAI_API_BIND=127.0.0.1 in /etc/puffpai/api.env if nothing off
    # this box needs the backend: the dashboard, the kiosk, the voice service
    # and Node-RED all reach it on loopback. That is strictly the safer
    # posture, and it is the one to choose if you are unsure — this appliance
    # ships with no host packet filter, so the API key is the only control in
    # front of the port.
    host = os.environ.get("PUFFPAI_API_BIND", "").strip() or "0.0.0.0"
    logger.info("PuffPAI API listening on %s:8000", host)
    app.run(host=host, port=8000, debug=False, threaded=True)


if __name__ == "__main__":
    main()
