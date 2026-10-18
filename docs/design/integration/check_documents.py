#!/usr/bin/env python3
"""Cross-checks of the SRS and the eight System Design Document units (Unit 9).

usage: python3 check_documents.py DOCS_DIR [EVENTS_FROM_DB [TEST_LABELS_DIR]]
  DOCS_DIR         the repository's docs/ folder (srs.tex and design/0N_*.tex)
  EVENTS_FROM_DB   optional file with one event name per line, as written by the database functions
  TEST_LABELS_DIR  optional folder of test outputs (lines starting PASS), for the test-evidence count

Prints PASS or FAIL lines, then the details the Unit 9 document reports. Exit status 1 on FAIL.
"""
import re, sys, pathlib, collections, json

docs = pathlib.Path(sys.argv[1])
db_events = set()
if len(sys.argv) > 2:
    db_events = {l.strip() for l in pathlib.Path(sys.argv[2]).read_text().split()
                 if re.fullmatch(r'[a-z_]+\.[a-z_]+\.[a-z_]+', l.strip())}
labels_dir = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else None
units = {int(p.name[:2]): p for p in sorted((docs / 'design').glob('0[1-9]_*.tex'))}
text = {u: p.read_text(encoding='utf-8') for u, p in units.items()}
srs = (docs / 'srs.tex').read_text(encoding='utf-8')
fails = 0
report = {}

def check(label, offenders):
    global fails
    if offenders:
        fails += 1
        print(f'FAIL  {label}: ' + ', '.join(sorted(map(str, offenders))[:15]) + (' ...' if len(offenders) > 15 else ''))
    else:
        print(f'PASS  {label}')

def plain(s):
    s = s.replace('\\_', '_')
    return re.sub(r'\\allowbreak(\{\})?\s*', '', s)

# ------------------------------------------------------------------ 1. requirement coverage
reqs = {m.group(1): (m.group(2), m.group(3)) for m in re.finditer(r'\\req\{([A-Z]+-[A-Z]+-\d+)\}\{([MSC])\}\{([A-Z])\}', srs)}
mentioned = collections.defaultdict(set)
for u, t in text.items():
    t = plain(t)
    for m in re.finditer(r'\b([A-Z]+-[A-Z]+)-(\d+)\b', t):
        mentioned[f'{m.group(1)}-{m.group(2)}'].add(u)
    for m in re.finditer(r'\b([A-Z]+-[A-Z]+)-(\d+)\s*(?:to|--|\.\.)\s*(?:\1-)?(\d+)\b', t):
        for n in range(int(m.group(2)), int(m.group(3)) + 1):
            mentioned[f'{m.group(1)}-{n:02d}'].add(u)
uncovered = sorted(r for r in reqs if r not in mentioned)
unknown = sorted(r for r in mentioned if r not in reqs and re.match(r'(FR|NFR|SEC|IF)-', r))
report['mentions'] = {r: sorted(mentioned[r]) for r in reqs if r in mentioned}
# who designed a requirement, apart from this integration unit (which names nearly everything once)
report['mentions_1_8'] = {r: sorted(x for x in mentioned[r] if x != 9) for r in reqs if r in mentioned}
report['requirements'] = {'total': len(reqs), 'covered': len(reqs) - len(uncovered),
                          'by_priority': dict(collections.Counter(p for p, _ in reqs.values())),
                          'uncovered': {r: reqs[r] for r in uncovered}}
print(f'INFO  {len(reqs)} SRS requirements; {len(reqs) - len(uncovered)} named by Units 1-{max(units)}; {len(uncovered)} not named')
check('every requirement a design unit names exists in the SRS', unknown)
check('every SRS requirement is named by at least one design unit', uncovered)

# ------------------------------------------------------------------ 2. design values DV-n
dv = collections.defaultdict(list)
for u, t in text.items():
    for m in re.finditer(r'^\s*DV-(\d+)\s*&', t, re.M):
        dv[int(m.group(1))].append(u)
top = max(dv)
check(f'design values DV-1 to DV-{top}: each defined exactly once',
      [f'DV-{n} x{len(dv[n])}' for n in range(1, top + 1) if len(dv[n]) != 1])
check('design values are numbered in unit order',
      [f'DV-{n} (Unit {dv[n][0]})' for n in range(2, top + 1) if dv[n] and dv[n - 1] and dv[n][0] < dv[n - 1][0]])
report['dv'] = {u: [n for n in sorted(dv) if dv[n][0] == u] for u in units}

# ------------------------------------------------------------------ 3. integration notes I-n
notes = {}
for u, t in text.items():
    m = re.search(r'\\begin\{enumerate\}\[label=\\textbf\{I-\\arabic\*\}[^\]]*\](.*)', t, re.S)
    if not m:
        continue
    body, depth, items, start = m.group(1), 0, [], 1
    sc = re.match(r'\s*\\setcounter\{enumi\}\{(\d+)\}', body)
    if sc:
        start = int(sc.group(1)) + 1
    for tok in re.finditer(r'\\begin\{(itemize|enumerate)\}|\\end\{(itemize|enumerate)\}|\\item\b', body):
        if tok.group(1): depth += 1
        elif tok.group(2):
            if depth == 0: break
            depth -= 1
        elif depth == 0:
            items.append(tok.end())
    labels = []
    for i, pos in enumerate(items):
        end = items[i + 1] if i + 1 < len(items) else len(body)
        chunk = body[pos:end]
        lab = re.match(r'\s*\\textbf\{((?:[^{}]|\{[^{}]*\})*)\}', chunk)
        rest = chunk[lab.end():] if lab else chunk
        rest = re.split(r'\\begin\{itemize\}', rest)[0]
        labels.append({'label': plain(lab.group(1)).rstrip('.:') if lab else '?', 'text': ' '.join(plain(rest).split())})
    notes[u] = (start, start + len(items) - 1, labels)
seq = []
for u in sorted(notes):
    seq.extend(range(notes[u][0], notes[u][1] + 1))
check(f'integration notes I-1 to I-{max(seq)} are numbered without gaps or repeats across the units',
      [n for n in range(1, max(seq) + 1) if seq.count(n) != 1])
report['notes'] = {u: {'from': a, 'to': b, 'targets': l} for u, (a, b, l) in notes.items()}

# ------------------------------------------------------------------ 4. events
def event_rows(t):
    """(published, consumed) names from a unit's events tables."""
    t = plain(t)
    pub, con = set(), set()
    for sect in re.finditer(r'\\subsection\{Events( published| consumed)?\}(.*?)\\bottomrule', t, re.S):
        kind = (sect.group(1) or '').strip()
        mode = 'published' if kind == 'published' else 'consumed' if kind == 'consumed' else None
        for line in sect.group(2).split('\n'):
            if 'Published' in line and 'multicolumn' in line: mode = 'published'; continue
            if 'Consumed' in line and 'multicolumn' in line: mode = 'consumed'; continue
            if '&' not in line or mode is None or 'textbf{Event' in line: continue
            first = line.split('&')[0]
            first = re.sub(r'\\texttt\{([^}]*)\}', r'\1', first)
            first = re.sub(r'\\textnormal\{[^}]*\}|\([^)]*\)|\\[a-z]+', ' ', first)
            prev = None
            for tok in re.findall(r'[a-z_]*(?:\.[a-z_*]+)+', first):
                if tok.startswith('.'):
                    if prev is None: continue
                    parts = prev.split('.')
                    k = tok.count('.')
                    tok = '.'.join(parts[:3 - k]) + tok
                if tok.count('.') != 2: continue
                prev = tok
                (pub if mode == 'published' else con).add(tok)
    return pub, con

published, consumed = {}, {}
for u, t in text.items():
    published[u], consumed[u] = event_rows(t)
# Unit 9's catalogue adds events that an integration note asked for, attributed to their publisher
added_events = {}
if 9 in text:
    sect = re.search(r'\\subsection\{Events added by integration\}(.*?)\\bottomrule', plain(text[9]), re.S)
    for m in re.finditer(r'\\texttt\{([a-z_]+\.[a-z_]+\.[a-z_]+)\}\s*&\s*Unit\s*~?(\d)', sect.group(1) if sect else ''):
        added_events[m.group(1)] = int(m.group(2))
        published.setdefault(int(m.group(2)), set()).add(m.group(1))
all_pub = set().union(*published.values()) | db_events
def is_published(e):
    if e.endswith('.*'): return any(p.startswith(e[:-1]) for p in all_pub)
    return e in all_pub
missing = sorted({f'{e} (Unit {u})' for u in consumed for e in consumed[u] if not is_published(e)})
check('every event a unit consumes is published by some unit', missing)
undocumented = sorted(db_events - set().union(*published.values()))
check('every event the database functions write is listed by its unit', undocumented)
names_bad = sorted(e for e in all_pub if not re.fullmatch(r'[a-z_]+\.[a-z_]+\.[a-z_]+', e))
check('event names follow <unit>.<entity>.<past> (DC-6)', names_bad)
report['events'] = {'published': {u: sorted(v) for u, v in published.items()},
                    'consumed': {u: sorted(v) for u, v in consumed.items()}, 'db': sorted(db_events),
                    'missing': missing, 'undocumented': undocumented}

# ------------------------------------------------------------------ 5. ports
provided = collections.defaultdict(set)
for u, t in text.items():
    if u == 9: continue          # Unit 9's listing declares ports on behalf of their owners (below)
    for blk in re.finditer(r'\\begin\{lstlisting\}(.*?)\\end\{lstlisting\}', t, re.S):
        for m in re.finditer(r'^\s*interface (\w+)', blk.group(1), re.M):
            provided[u].add(m.group(1))
if 9 in text:   # Unit 9 declares ports that earlier units named but did not define; each says its owner
    for blk in re.finditer(r'\\begin\{lstlisting\}(.*?)\\end\{lstlisting\}', text[9], re.S):
        for m in re.finditer(r'^\s*interface (\w+)[^\n]*//\s*Unit (\d)', blk.group(1), re.M):
            provided[int(m.group(2))].add(m.group(1))
required_bad, required = [], []
for u, t in text.items():
    sect = re.search(r'\\subsection\{Ports required\}(.*?)\\bottomrule', t, re.S)
    if not sect: continue
    for line in sect.group(1).split('\n'):
        if '&' not in line: continue
        first = line.split('&')[0]
        um = re.findall(r'\(Unit\s*~?\s*(\d)\)', first) or re.findall(r'Unit\s*~?\s*(\d)', line.split('&')[1] if '&' in line else '')
        names = re.findall(r'\\texttt\{(\w+)\}', first)
        if not um or not names: continue
        owner = int(um[0])
        for n in names:
            required.append((u, n, owner))
            if owner in units and n not in provided[owner]:
                required_bad.append(f'{n} (Unit {u} expects it from Unit {owner})')
check('every port a unit requires is declared by the unit it names', sorted(set(required_bad)))
report['ports'] = {'provided': {u: sorted(v) for u, v in provided.items()}, 'required': required, 'missing': sorted(set(required_bad))}

# ------------------------------------------------------------------ 6. conventions
dc = collections.defaultdict(list)
for u, t in text.items():
    for m in re.finditer(r'(?:^\s*DC-(\d+)\s*&|\\textbf\{DC-(\d+)\.\})', t, re.M):
        dc[int(m.group(1) or m.group(2))].append(u)
check(f'conventions DC-1 to DC-{max(dc)} are each defined once', [f'DC-{n} x{len(dc[n])}' for n in range(1, max(dc) + 1) if len(dc[n]) != 1])

# ------------------------------------------------------------------ 7. test evidence
if labels_dir:
    labels = '\n'.join(p.read_text() for p in sorted(labels_dir.glob('*.txt')))
    labels = '\n'.join(l for l in labels.split('\n') if l.startswith('PASS'))
    tested = set(re.findall(r'\b((?:FR|NFR|SEC|IF)-[A-Z]+-\d+)', labels))
    for m in re.finditer(r'\b((?:FR|NFR|SEC|IF)-[A-Z]+)-(\d+)\s*(?:to|,)\s*(?:\1-)?(\d+)\b', labels):
        tested.update(f'{m.group(1)}-{n:02d}' for n in range(int(m.group(2)), int(m.group(3)) + 1))
    sec_t = sorted(r for r, (p, v) in reqs.items() if r.startswith('SEC-') and v == 'T')
    fr_mt = sorted(r for r, (p, v) in reqs.items() if r.startswith('FR-') and p == 'M' and v == 'T')
    report['tests'] = {'labels': labels.count('PASS'), 'sec_T': len(sec_t), 'sec_T_tested': [r for r in sec_t if r in tested],
                       'sec_T_untested': [r for r in sec_t if r not in tested],
                       'fr_MT': len(fr_mt), 'fr_MT_tested': [r for r in fr_mt if r in tested]}
    print(f"INFO  {labels.count('PASS')} passing test labels; they name {len([r for r in sec_t if r in tested])} of {len(sec_t)} "
          f"SEC requirements verified by test, and {len([r for r in fr_mt if r in tested])} of {len(fr_mt)} Must FR verified by test")
    check('every test label names a requirement that exists', sorted(r for r in tested if r not in reqs))

pathlib.Path('document_report.json').write_text(json.dumps(report, indent=1, default=str))
print(f'\n{fails} checks failed')
sys.exit(1 if fails else 0)
