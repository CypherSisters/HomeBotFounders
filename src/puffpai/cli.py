"""
PuffPAI Command-Line Interface

Provides headless operation for terminal-based chat, ZIM management,
firewall status, and system diagnostics.

Usage:
    python -m puffpai chat              # Interactive text chat
    python -m puffpai ingest-zim <path> # Ingest a ZIM file
    python -m puffpai discover-zim      # List discovered ZIM files
    python -m puffpai firewall-status   # Show firewall status
    python -m puffpai version           # Print version

Copyright (c) 2025 Cypher Sisters. Apache-2.0 License.
"""

from __future__ import annotations

import argparse
import sys


def _cmd_version(args: argparse.Namespace) -> int:
    """Print PuffPAI version."""
    from puffpai import __version__
    print(f"PuffPAI v{__version__}")
    return 0


def _cmd_chat(args: argparse.Namespace) -> int:
    """Interactive text chat loop (headless)."""
    from puffpai import __version__

    print(f"PuffPAI v{__version__} — Interactive Chat")
    print("Type 'quit' or 'exit' to leave.\n")

    try:
        from puffpai.config import get_llm_backend
        backend = get_llm_backend()
        print(f"Backend: {backend.model_name}")
    except Exception as exc:
        print(f"[Warning] No LLM backend available: {exc}")
        print("Running in echo mode (no AI responses).\n")
        backend = None

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            return 0

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit", "bye"):
            print("Goodbye!")
            return 0

        if backend is None:
            print(f"PuffPAI: [Echo] {user_input}\n")
        else:
            try:
                response = backend.chat(
                    [{"role": "user", "content": user_input}],
                    temperature=0.7,
                )
                print(f"PuffPAI: {response}\n")
            except Exception as exc:
                print(f"PuffPAI: [Error] {exc}\n")

    return 0


def _cmd_discover_zim(args: argparse.Namespace) -> int:
    """List discovered ZIM files from configured paths."""
    from puffpai.knowledge.discovery import discover_from_config, get_zim_metadata

    zim_files = discover_from_config()
    if not zim_files:
        print("No ZIM files found in configured paths.")
        print("Configure paths.zim_dirs in config/puffpai_config.json")
        return 0

    print(f"Discovered {len(zim_files)} ZIM file(s):\n")
    for path in zim_files:
        try:
            meta = get_zim_metadata(path)
            size_mb = meta["file_size_bytes"] / (1024 * 1024)
            print(f"  {meta['filename']}")
            print(f"    Path: {meta['filepath']}")
            print(f"    Entries: {meta['entry_count']:,} | Clusters: {meta['cluster_count']:,}")
            print(f"    Size: {size_mb:.1f} MB | ZIM v{meta['major_version']}.{meta['minor_version']}")
            print()
        except Exception as exc:
            print(f"  {path}")
            print(f"    [Error reading metadata: {exc}]\n")

    return 0


def _cmd_ingest_zim(args: argparse.Namespace) -> int:
    """Ingest a ZIM file into the knowledge base."""
    import os

    zim_path = args.path
    if not os.path.isfile(zim_path):
        print(f"Error: File not found: {zim_path}")
        return 1

    print(f"Ingesting ZIM file: {zim_path}")

    try:
        from puffpai.knowledge.zim_reader import ZIMReader, ZIMTruncatedError
        from puffpai.knowledge.ingestion import KnowledgeIngestion

        try:
            with ZIMReader(zim_path) as reader:
                print(f"  Entries: {reader.entry_count:,}")
        except ZIMTruncatedError as exc:
            print(f"Error: {exc}")
            return 1

        # Delegate to KnowledgeIngestion.ingest_zim() rather than re-implementing
        # the walk here. The previous inline loop called get_article(0) with a
        # hardcoded placeholder index, so it re-ingested entry 0 under every other
        # entry's title, and iter_articles() defaulted to namespace 'A' (empty for
        # ZIM v6). ingest_zim() detects the namespace, retrieves by real index, and
        # also picks up VTT transcripts and PDFs.
        ingestion = KnowledgeIngestion()
        docs = ingestion.ingest_zim(
            zim_path,
            max_articles=args.max or 0,   # 0 = all; previously capped at 1000
        )

        print(f"  Done! Ingested {len(docs):,} documents from "
              f"{os.path.basename(zim_path)}")
        if not docs:
            print("  (nothing indexed -- pack may hold no extractable text)")
        return 0

    except Exception as exc:
        print(f"Error: {exc}")
        return 1


def _cmd_firewall_status(args: argparse.Namespace) -> int:
    """Show current firewall status."""
    try:
        from puffpai.firewall_manager import FirewallManager
        fm = FirewallManager()
        rules = fm.list_rules()
        print(f"Firewall rules: {len(rules)}")
        for rule in rules[:20]:
            print(f"  {rule}")
        if len(rules) > 20:
            print(f"  ... and {len(rules) - 20} more")
        return 0
    except Exception as exc:
        print(f"Firewall status unavailable: {exc}")
        return 1


def _cmd_hatch(args: argparse.Namespace) -> int:
    """Run (or replay) the hatch ritual from the terminal.

    The terminal has no talking avatar, so the script is printed as the lines
    the Puff would speak; the dashboard hatch page performs the same ritual
    with the real voice.
    """
    from puffpai import hatch

    require_voice = not args.no_voice
    preflight = hatch.run_preflight(require_voice=require_voice)

    # ASCII-only console output: the Windows terminal codepage mangles
    # em-dashes, and this command is exactly the one run on a fresh box.
    print("Pre-flight (real probes; /health is a liar and is not used):")
    for check in preflight["checks"]:
        mark = {"ok": "ok  ", "warn": "warn", "fail": "FAIL"}[check["status"]]
        print(f"  [{mark}] {check['label']}: {check['detail']}")
    if not preflight["ok"]:
        print("\nRefusing to hatch: fix the failures above first. "
              "A Puff does not promise 'everything stays in this box' "
              "while half the box is down.")
        return 2

    try:
        result = hatch.perform_hatch(
            args.name, rename=args.rename, require_voice=require_voice,
            preflight=preflight)
    except hatch.HatchNameRequired:
        print("\nThis build has not hatched yet. The Puff asks:")
        print(f'  "{hatch.ask_line()}"')
        print("\nName it with: py -3.14 -m puffpai hatch --name <Name>")
        return 1

    print()
    if result["replay"]:
        print(f"Replaying the hatch for {result['name']} "
              f"(hatched {result['hatch_date']}, "
              f"replay #{result['replays']}).")
        if result.get("name_ignored"):
            print("  (name argument ignored: replays never rename; "
                  "pass --rename to rename on purpose)")
    else:
        print(f"Hatched: {result['name']} on {result['hatch_date']}.")
    print()
    for line in result["script"]:
        print(f"  {result['name']}: {line['text']}")
    return 0


def _cmd_certificate(args: argparse.Namespace) -> int:
    """Generate the adoption certificate (SVG natively; PNG via Pillow)."""
    from puffpai import certificate

    fmt = "png" if args.png else "svg"
    try:
        payload = certificate.generate(fmt=fmt)
    except certificate.CertificateUnavailable as exc:
        print(f"Error: {exc}")
        return 1

    out = args.out
    if not out:
        out = f"adoption_certificate.{fmt}"
    with open(out, "wb") as fh:
        fh.write(payload)
    print(f"Certificate written: {out} ({len(payload):,} bytes, {fmt})")
    if fmt == "svg" and not certificate.png_available():
        print("  (PNG export unavailable: Pillow not installed; "
              "the SVG is the canonical artifact)")
    return 0


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""
    parser = argparse.ArgumentParser(
        prog="puffpai",
        description="PuffPAI — Privacy-first, offline-capable AI assistant",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # version
    sub = subparsers.add_parser("version", help="Print version")
    sub.set_defaults(func=_cmd_version)

    # chat
    sub = subparsers.add_parser("chat", help="Interactive text chat (headless)")
    sub.set_defaults(func=_cmd_chat)

    # discover-zim
    sub = subparsers.add_parser("discover-zim", help="List discovered ZIM files")
    sub.set_defaults(func=_cmd_discover_zim)

    # ingest-zim
    sub = subparsers.add_parser("ingest-zim", help="Ingest a ZIM file")
    sub.add_argument("path", help="Path to ZIM file")
    sub.add_argument("--max", type=int, default=1000,
                     help="Max articles to ingest (default: 1000)")
    sub.set_defaults(func=_cmd_ingest_zim)

    # firewall-status
    sub = subparsers.add_parser("firewall-status", help="Show firewall status")
    sub.set_defaults(func=_cmd_firewall_status)

    # hatch
    sub = subparsers.add_parser(
        "hatch", help="Run (or replay) the hatch ritual")
    sub.add_argument("--name", help="Name for a first hatch (or with --rename)")
    sub.add_argument("--rename", action="store_true",
                     help="Explicitly rename an already-hatched Puff")
    sub.add_argument("--no-voice", action="store_true",
                     help="Do not require the local Piper voice in pre-flight")
    sub.set_defaults(func=_cmd_hatch)

    # certificate
    sub = subparsers.add_parser(
        "certificate", help="Generate the adoption certificate")
    sub.add_argument("--out", help="Output path (default: "
                                   "adoption_certificate.<fmt>)")
    sub.add_argument("--png", action="store_true",
                     help="PNG via Pillow instead of the native SVG")
    sub.set_defaults(func=_cmd_certificate)

    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.command:
        parser.print_help()
        return 0

    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
