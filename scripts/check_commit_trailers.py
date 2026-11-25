#!/usr/bin/env python3
"""Fails when a commit message in a pull request carries an AI co-author or session trailer.

The project keeps its history under the authors' own names: no "Co-Authored-By: Claude ..." and no
"Claude-Session: ..." lines (PROGRESS.md, task P0-11). The check looks only at the commits the branch adds
(base..HEAD), so old history does not fail it.

    python3 scripts/check_commit_trailers.py [BASE]          # BASE defaults to origin/main
"""
import re
import subprocess
import sys

BAD = re.compile(r"^\s*(co-authored-by:.*(claude|anthropic)|claude-session:|generated with \[?claude code)", re.I)


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "origin/main"
    out = subprocess.run(["git", "log", "--format=%H%x00%B%x01", f"{base}..HEAD"], capture_output=True, text=True, check=True).stdout
    problems = []
    for entry in filter(None, out.split("\x01")):
        sha, _, body = entry.strip("\n").partition("\x00")
        for line in body.splitlines():
            if BAD.match(line):
                problems.append(f"{sha[:8]}: {line.strip()}")
    for p in problems:
        print("PROBLEM", p)
    print(f"{len(problems)} problems in the commits of {base}..HEAD")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
