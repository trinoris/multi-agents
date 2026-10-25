#!/usr/bin/env python3
"""
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.

Trinoris Multi-Agent Coordination CLI
"""

import argparse
import sys
import os
from pathlib import Path

from .commands.setup import setup_command
from .commands.verify import verify_command


SUPERSEDED_BY_TS = {
    "acquire", "release", "renew", "check", "status", "break", "claim",
}

TS_PACKAGE = "@trinoris/agent-cli"


def _explain_superseded(cmd: str) -> None:
    """This CLI only has setup/verify. The TypeScript CLI is a superset and owns the
    same `trinoris-agent` command name, so whichever is later on PATH wins. Without
    this, an agent following the generated AGENTS.md gets argparse's bare
    "invalid choice", which says nothing about why or what to install."""
    import sys
    print(
        f"`{cmd}` is not in this (Python) build of trinoris-agent.\n"
        f"\nThe lock engine now lives in {TS_PACKAGE}, which supports:\n"
        "  status, acquire, renew, release, check, break, claim, setup, verify\n"
        f"\nThis Python CLI is superseded and kept only for setup/verify. Both packages\n"
        "install the same `trinoris-agent` command, so this one may be shadowing the\n"
        "TypeScript build on your PATH. Install and prefer the Node one:\n"
        f"\n  pnpm add -g {TS_PACKAGE}\n"
        "\nOr call it directly: node <repo>/packages/cli/dist/bin.js " + cmd,
        file=sys.stderr,
    )
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        prog="trinoris-agent",
        description="Multi-agent coordination protocol CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Initialize coordination in current directory
  trinoris-agent setup
  
  # Verify protocol setup and filesystem atomicity
  trinoris-agent verify
  
  # Use custom work directory
  trinoris-agent --work-dir /path/to/repo setup

For more information, see:
  https://github.com/trinoris/trinoris-multi-agents
"""
    )
    
    parser.add_argument(
        "--work-dir",
        default=".",
        help="Working directory (default: current directory)"
    )
    
    parser.add_argument(
        "--version",
        action="version",
        version="trinoris-agent 0.1.0 (Python; superseded by @trinoris/agent-cli)"
    )
    
    # Before argparse rejects it as an invalid choice, say something useful.
    if len(sys.argv) > 1 and sys.argv[1] in SUPERSEDED_BY_TS:
        _explain_superseded(sys.argv[1])

    subparsers = parser.add_subparsers(dest="command", help="Commands")
    
    # Setup command
    setup_parser = subparsers.add_parser(
        "setup",
        help="Initialize coordination structure and generate skills"
    )
    setup_parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing coordination directory"
    )
    setup_parser.add_argument(
        "--update-skills",
        action="store_true",
        help="Update skills only, preserve coordination state"
    )
    
    # Verify command
    verify_parser = subparsers.add_parser(
        "verify",
        help="Verify protocol setup and filesystem atomicity"
    )
    verify_parser.add_argument(
        "--trials",
        type=int,
        default=100,
        help="Number of trials for atomicity test (default: 100)"
    )
    verify_parser.add_argument(
        "--concurrency",
        type=int,
        default=8,
        help="Concurrent processes for atomicity test (default: 8)"
    )
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        sys.exit(1)
    
    # Resolve work directory
    work_dir = Path(args.work_dir).resolve()
    if not work_dir.exists():
        print(f"✗ Work directory does not exist: {work_dir}", file=sys.stderr)
        sys.exit(1)
    
    # Dispatch commands
    try:
        if args.command == "setup":
            setup_command(work_dir, args.force, args.update_skills)
        elif args.command == "verify":
            verify_command(work_dir, args.trials, args.concurrency)
        else:
            parser.print_help()
            sys.exit(1)
    except Exception as e:
        print(f"✗ Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
