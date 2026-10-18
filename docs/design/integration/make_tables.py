#!/usr/bin/env python3
"""Writes the generated LaTeX tables of the Unit 9 document from the checks' outputs.
usage: python3 make_tables.py REPORT_JSON MODEL_TXT OUT_DIR"""
import json, re, sys, pathlib, collections

rep = json.loads(pathlib.Path(sys.argv[1]).read_text())
model = [l.split('|') for l in pathlib.Path(sys.argv[2]).read_text().split('\n') if l and not l.startswith('==')]
out = pathlib.Path(sys.argv[3]); out.mkdir(exist_ok=True)

def esc(s):
    return (s.replace('\\', '\\textbackslash{}').replace('_', '\\_').replace('&', '\\&').replace('%', '\\%')
             .replace('#', '\\#').replace('$', '\\$').replace('{', '\\{').replace('}', '\\}'))
def tt(s):  # an identifier in typewriter type, breakable at dots and underscores
    return '\\texttt{' + esc(s).replace('.', '.\\allowbreak ').replace('\\_', '\\_\\allowbreak ') + '}'
def latexify(text):
    """plain note text (texttt kept as commands) -> safe LaTeX, first sentence only"""
    keep = []
    def hold(m):
        keep.append(m.group(1)); return f'\x00{len(keep) - 1}\x00'
    s = re.sub(r'\\texttt\{((?:\\\{|\\\}|[^{}])*)\}', hold, text)
    s = re.sub(r'\\item\b.*$', '', s)
    s = re.sub(r'\\(emph|textbf|textit)\{([^{}]*)\}', r'\2', s)
    s = re.sub(r'~', ' ', s)
    s = re.sub(r'\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^{}]*\})?', '', s)
    s = s.replace('\\{', '{').replace('\\}', '}').replace('\\&', '&')
    parts = re.split(r'(?<=[.])\s+', s.strip())
    s = ''
    for x in parts:                      # whole sentences, at least about 50 characters
        s = (s + ' ' + x).strip()
        if len(s) >= 50: break
    if len(s) > 150:
        s = s[:147].rsplit(' ', 1)[0] + ' \u2026'
    s = esc(s).replace('\u2026', '\\ldots')
    return re.sub('\x00(\\d+)\x00', lambda m: tt(keep[int(m.group(1))].replace('\\{', '{').replace('\\}', '}')), s)

# ---------------------------------------------------------------- combined data model
rows = []
tot = collections.Counter()
for unit, schema, tables, views, funcs, trig_fns, triggers, enums, checks, indexes in model[:13]:
    rows.append(f'{unit} & \\texttt{{{esc(schema)}}} & {tables} & {views} & {int(funcs) + int(trig_fns)} & {triggers} & {enums} & {checks} & {indexes} \\\\')
    for k, v in zip(('t', 'v', 'f', 'g', 'e', 'c', 'i'), (tables, views, int(funcs) + int(trig_fns), triggers, enums, checks, indexes)):
        tot[k] += int(v)
rows.append('\\midrule')
rows.append(f'& \\textbf{{All}} & {tot["t"]} & {tot["v"]} & {tot["f"]} & {tot["g"]} & {tot["e"]} & {tot["c"]} & {tot["i"]} \\\\')
(out / 't_model.tex').write_text('\n'.join(rows) + '\n')

edges = collections.defaultdict(int)
for l in model[13:]:
    if len(l) == 4:
        edges[(int(l[0]), int(l[1]), l[2])] += int(l[3])
(out / 'edges.json').write_text(json.dumps({f'{a}-{b}-{c}': n for (a, b, c), n in edges.items()}))

# ---------------------------------------------------------------- event catalogue
pub = {int(u): set(v) for u, v in rep['events']['published'].items()}
con = {int(u): set(v) for u, v in rep['events']['consumed'].items()}
for e in rep['events']['db']:
    owner = {'identity': 1, 'orders': 2, 'payments': 2, 'listings': 3, 'auctions': 3, 'delivery': 4, 'game_accounts': 5,
             'chat': 6, 'notify': 6, 'disputes': 7, 'trust': 7, 'staff': 7}[e.split('.')[0]]
    pub.setdefault(owner, set()).add(e)
def consumers(e):
    us = set()
    for u, s in con.items():
        for c in s:
            if c == e or (c.endswith('.*') and e.startswith(c[:-1])):
                us.add(u)
    return us
rows = []
for u in sorted(pub):
    for e in sorted(pub[u]):
        cs = consumers(e)
        rows.append(f'{tt(e)} & {u} & {", ".join(str(c) for c in sorted(cs)) if cs else "none listed"} \\\\')
(out / 't_events.tex').write_text('\n'.join(rows) + '\n')
(out / 'n_events.txt').write_text(str(sum(len(v) for v in pub.values())))

# ---------------------------------------------------------------- ports
req_by = collections.defaultdict(set)
for u, name, owner in rep['ports']['required']:
    req_by[(owner, name)].add(u)
rows = []
for u in sorted(rep['ports']['provided'], key=int):
    for p in sorted(rep['ports']['provided'][u]):
        users = sorted(req_by.get((int(u), p), set()))
        rows.append(f'\\texttt{{{p}}} & {u} & {", ".join(map(str, users)) if users else "---"} \\\\')
(out / 't_ports.tex').write_text('\n'.join(rows) + '\n')

# ---------------------------------------------------------------- integration register
rows = []
for u in sorted(rep['notes'], key=int):
    if int(u) == 9:          # this unit's own notes are in its Notes section
        continue
    n = rep['notes'][u]
    for i, item in enumerate(n['targets']):
        num = n['from'] + i
        raw = item['label']
        label = re.sub(r'\\texttt\{([^}]*)\}', r'\1', raw)
        src = int(u)
        if 'SRS' in label:
            status, owner, text = 'SRS update', 'SRS', 'Clarifications proposed to the SRS (listed in the unit).'
            rows.append(f'I-{num} & {u} & {owner} & {esc(text)} & {status} \\\\'); continue
        us = re.findall(r'Units? ~?(\d)(?: and (\d))?', label)
        owners = sorted({int(x) for t in us for x in t if x}) or [src]
        owner = ', '.join(map(str, owners))
        if owners == [9]: status = 'Done here'
        elif all(o < src for o in owners): status = 'Change to ' + ('Unit ' if len(owners) == 1 else 'Units ') + owner
        elif all(o > src for o in owners): status = 'Input to ' + ('Unit ' if len(owners) == 1 else 'Units ') + owner
        else: status = 'Unit ' + owner
        # the label's own words, when it names a topic rather than only a unit
        topic = re.sub(r'^Units? ~?\d( and \d)?(, )?', '', raw).strip(' :')
        topic = re.sub(r'\s*\(Unit ~?\d\)', '', topic)
        topic = re.sub(r'^\((.*)\)$', r'\1', topic)
        body = item['text']
        if topic and not topic.lower().startswith('unit'):
            topic = topic[0].upper() + topic[1:]
            body = topic + ('' if re.match(r'^[a-z]', body) else ':') + ' ' + body
        rows.append(f'I-{num} & {u} & {owner} & {latexify(body)} & {status} \\\\')
(out / 't_register.tex').write_text('\n'.join(rows) + '\n')

# ---------------------------------------------------------------- security tests still to write
t = rep.get('tests', {})
rows = []
for r in t.get('sec_T_untested', []):
    owners = rep.get('mentions_1_8', {}).get(r, [])
    rows.append(f'{r} & {", ".join(map(str, owners)) if owners else "9"} \\\\')
(out / 't_sec_untested.tex').write_text('\n'.join(rows) + '\n')
half = (len(rows) + 1) // 2
left, right = rows[:half], rows[half:]
two = []
for i in range(half):
    l = left[i].rstrip(' \\')
    r = right[i].rstrip(' \\') if i < len(right) else ' & '
    two.append(f'{l} & {r} \\\\')
(out / 't_sec_untested_2col.tex').write_text('\n'.join(two) + '\n')
(out / 'n_tests.json').write_text(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in t.items()}))

# ---------------------------------------------------------------- design values per unit
rows = []
for u in sorted((x for x in rep['dv'] if int(x) != 9), key=int):
    v = rep['dv'][u]
    if v:
        rows.append(f'{u} & DV-{v[0]} to DV-{v[-1]} & {len(v)} \\\\' if len(v) > 1 else f'{u} & DV-{v[0]} & 1 \\\\')
(out / 't_dv.tex').write_text('\n'.join(rows) + '\n')
print('written to', out)
