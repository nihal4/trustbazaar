#!/usr/bin/env python3
"""The developer guides stay true (U11-12; BUILDING.md section 8).

  1. every area has its README: each folder of frontend/src/features and backend/src/modules, frontend/src/shared, frontend/src/shared/ui, frontend/src/staff, backend/src/kernel;
  2. every relative link of the guides and READMEs points at a file or folder that exists;
  3. every file a README names in `backticks` (a bare file name such as `SignInPage.tsx`) exists somewhere inside that README's folder;
  4. docs/api/openapi.json exists (it is generated; backend/test/api/openapi.spec.ts keeps it current).

Run from anywhere:  python3 scripts/check_docs.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
problems = []

areas = [*sorted(p for p in (ROOT / "frontend/src/features").iterdir() if p.is_dir()), *sorted(p for p in (ROOT / "backend/src/modules").iterdir() if p.is_dir())]
areas += [ROOT / "frontend/src/shared", ROOT / "frontend/src/shared/ui", ROOT / "frontend/src/staff", ROOT / "backend/src/kernel"]
for d in areas:
    if not (d / "README.md").exists():
        problems.append(f"{d.relative_to(ROOT)}: no README.md")

guides = [ROOT / n for n in ("README.md", "ARCHITECTURE.md", "BUILDING.md", "CONTRIBUTING.md")]
guides += sorted((ROOT / "docs").glob("HOW-TO.md")) + sorted((ROOT / "docs/api").glob("*.md")) + sorted((ROOT / "docs/decisions").glob("*.md"))
guides += [d / "README.md" for d in areas if (d / "README.md").exists()]

LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
FILENAME = re.compile(r"`([A-Za-z0-9_.-]+\.(?:tsx?|css|mjs|json))`")
for g in guides:
    text = g.read_text(encoding="utf-8")
    for target in LINK.findall(text):
        if re.match(r"^(https?:|mailto:|#)", target):
            continue
        path = target.split("#")[0]
        if path and not (g.parent / path).exists():
            problems.append(f"{g.relative_to(ROOT)}: the link to {target} points at nothing")
    if g.name == "README.md" and g.parent in areas:
        for name in sorted(set(FILENAME.findall(text))):
            if not any(g.parent.rglob(name)):
                problems.append(f"{g.relative_to(ROOT)}: names `{name}`, which is not in that folder")

if not (ROOT / "docs/api/openapi.json").exists():
    problems.append("docs/api/openapi.json is missing (UPDATE_OPENAPI=1 npm run test:integration -- test/api/openapi.spec.ts)")

if problems:
    print("\n".join(f"PROBLEM  {p}" for p in problems))
    print(f"{len(problems)} problems")
    sys.exit(1)
print(f"{len(areas)} areas with their README, {len(guides)} guides checked, no problems")
