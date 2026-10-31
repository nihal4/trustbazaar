#!/usr/bin/env python3
"""Every test is named after the requirement it proves (BUILDING.md section 6; Unit 9, section 7.4).

A test title must start with an ID:
  FR-/NFR-/SEC-/IF-<AREA>-<nn>  a requirement of the SRS (docs/srs.tex), which must exist
  AC-<n>, DC-<n>, DV-<n>, CP-<n>, I-<n>  an acceptance criterion, design convention, design value,
                                parameter or integration note
Reads the test files of backend/ and frontend/ (it, test, and their .each/.todo/.skip/.only forms).

usage: python3 scripts/check_test_names.py [REPO_ROOT]     exit 1 if any title breaks the rule
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
GLOBS = ['backend/src/**/*.spec.ts', 'backend/test/**/*.spec.ts', 'frontend/src/**/*.test.ts', 'frontend/src/**/*.test.tsx']
ID = re.compile(r'^(?:(?P<req>(?:FR|NFR|SEC|IF)-[A-Z]+-\d+)|(?:AC|DC|DV|CP|I)-\d+)\b')
MODIFIERS = {'each', 'todo', 'skip', 'only', 'concurrent', 'failing'}


def skip_string(src, i):
    """src[i] is a quote; return the index just past the closing quote."""
    q, i = src[i], i + 1
    while i < len(src) and src[i] != q:
        i += 2 if src[i] == '\\' else 1
    return i + 1


def skip_balanced(src, i):
    """src[i] is an opening bracket; return the index just past its match (strings and comments skipped)."""
    depth = 0
    while i < len(src):
        c = src[i]
        if c in '\'"`':
            i = skip_string(src, i)
            continue
        if src.startswith('//', i):
            i = src.find('\n', i)
            i = len(src) if i < 0 else i
            continue
        if src.startswith('/*', i):
            i = src.find('*/', i) + 2
            continue
        if c in '([{':
            depth += 1
        elif c in ')]}':
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return i


def titles(src):
    """Yield (line, title or None) for each it(...)/test(...) call."""
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in '\'"`':
            i = skip_string(src, i)
            continue
        if src.startswith('//', i):
            i = src.find('\n', i)
            i = n if i < 0 else i
            continue
        if src.startswith('/*', i):
            i = src.find('*/', i) + 2
            continue
        m = re.compile(r'(it|test)\b').match(src, i)
        if m and (i == 0 or not (src[i - 1].isalnum() or src[i - 1] in '_$.')):
            j = m.end()
            while True:
                mod = re.compile(r'\s*\.\s*(\w+)').match(src, j)
                if not mod or mod.group(1) not in MODIFIERS:
                    break
                j = mod.end()
                if mod.group(1) == 'each':
                    k = re.compile(r'\s*').match(src, j).end()
                    if k < n and src[k] == '(':
                        j = skip_balanced(src, k)
                    elif k < n and src[k] == '`':
                        j = skip_string(src, k)
            k = re.compile(r'\s*').match(src, j).end()
            if k < n and src[k] == '(':
                a = re.compile(r'\s*').match(src, k + 1).end()
                line = src.count('\n', 0, i) + 1
                if a < n and src[a] in '\'"`':
                    end = skip_string(src, a)
                    yield line, src[a + 1:end - 1]
                else:
                    yield line, None
                i = k + 1
                continue
        i += 1


def main():
    srs = (ROOT / 'docs/srs.tex').read_text()
    known = set(re.findall(r'\\req\{([A-Z]+-[A-Z]+-\d+)\}', srs))
    bad, count = [], 0
    for pattern in GLOBS:
        for f in sorted(ROOT.glob(pattern)):
            if 'node_modules' in f.parts:
                continue
            for line, title in titles(f.read_text()):
                count += 1
                where = f'{f.relative_to(ROOT)}:{line}'
                if title is None:
                    bad.append(f'{where}: the title is not a string literal')
                    continue
                m = ID.match(title)
                if not m:
                    bad.append(f'{where}: "{title[:70]}" does not start with a requirement ID')
                elif m.group('req') and m.group('req') not in known:
                    bad.append(f'{where}: "{title[:70]}" names {m.group("req")}, which is not in docs/srs.tex')
    for b in bad:
        print('FAIL  ' + b)
    print(f'{count} test titles, {len(bad)} problems')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
