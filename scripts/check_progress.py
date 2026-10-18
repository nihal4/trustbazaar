#!/usr/bin/env python3
"""Checks PROGRESS.md and answers "what can I take next?".

  python3 scripts/check_progress.py            check the file; exit 1 on any problem
  python3 scripts/check_progress.py --next     also list tasks that can be started now
  python3 scripts/check_progress.py --summary  also print done/total per section

Rules checked (see BUILDING.md section 8):
  * every task row has a unique ID and a known status;
  * doing, review, done and blocked rows have an owner; doing and review rows name a branch or PR;
  * done rows have a PR and a date (YYYY-MM-DD), and appear in the Finished log;
  * blocked rows say why in Notes;
  * every ID in Needs exists, and a task that is doing, review or done has all its Needs done.
"""
import re, sys, pathlib

STATUSES = {'todo', 'doing', 'review', 'done', 'blocked'}
root = pathlib.Path(__file__).resolve().parent.parent
text = (root / 'PROGRESS.md').read_text(encoding='utf-8')

tasks, order, section, finished, problems = {}, [], None, set(), []
in_tasks = in_finished = False
for n, line in enumerate(text.split('\n'), 1):
    if line.startswith('## '):
        section = line[3:].strip()
        in_tasks = in_finished = False
        continue
    if line.startswith('| ID | Task | Needs |'):
        in_tasks = True; continue
    if line.startswith('| Date | Task | Owner | PR |'):
        in_finished = True; continue
    if not line.startswith('|') or set(line.replace('|', '').strip()) <= {'-', ' '}:
        if not line.startswith('|'): in_tasks = in_finished = False
        continue
    cells = [c.strip() for c in line.strip().strip('|').split('|')]
    if in_finished and len(cells) >= 4 and cells[1]:
        finished.add(cells[1])
    if not in_tasks:
        continue
    if len(cells) != 8:
        problems.append(f'line {n}: a task row needs 8 cells, found {len(cells)}'); continue
    tid, task, needs, status, owner, pr, done, notes = cells
    if not re.fullmatch(r'[A-Z][A-Z0-9]*-\d{2}', tid):
        problems.append(f'line {n}: bad task ID "{tid}"')
    if tid in tasks:
        problems.append(f'line {n}: task {tid} appears twice')
    deps = [] if needs in ('', '-') else [d.strip() for d in needs.split(',')]
    tasks[tid] = dict(line=n, section=section, task=task, needs=deps, status=status, owner=owner, pr=pr, done=done, notes=notes)
    order.append(tid)

for tid in order:
    t = tasks[tid]; n = t['line']; s = t['status']
    if s not in STATUSES:
        problems.append(f'line {n}: {tid} has unknown status "{s}" (use {", ".join(sorted(STATUSES))})'); continue
    if s != 'todo' and not t['owner']:
        problems.append(f'line {n}: {tid} is {s} but has no owner')
    if s in ('doing', 'review') and not t['pr']:
        problems.append(f'line {n}: {tid} is {s} but names no branch or PR')
    if s == 'done':
        if not re.search(r'#\d+|/pull/\d+', t['pr']):
            problems.append(f'line {n}: {tid} is done but has no PR number')
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', t['done']):
            problems.append(f'line {n}: {tid} is done but has no date (YYYY-MM-DD)')
        if tid not in finished:
            problems.append(f'line {n}: {tid} is done but missing from the Finished log')
    if s == 'blocked' and not t['notes']:
        problems.append(f'line {n}: {tid} is blocked but Notes does not say why')
    for d in t['needs']:
        if d not in tasks:
            problems.append(f'line {n}: {tid} needs unknown task {d}')
        elif s in ('doing', 'review', 'done') and tasks[d]['status'] != 'done':
            problems.append(f'line {n}: {tid} is {s} but {d} is {tasks[d]["status"]}, not done')
for f in sorted(finished - {t for t in tasks if tasks[t]['status'] == 'done'}):
    if f in tasks:
        problems.append(f'Finished log lists {f}, but its row is {tasks[f]["status"]}')

if '--summary' in sys.argv or '--next' in sys.argv:
    secs = {}
    for tid in order:
        secs.setdefault(tasks[tid]['section'], []).append(tasks[tid]['status'])
    for s, st in secs.items():
        print(f'{st.count("done"):3}/{len(st):<3} done  {st.count("doing") + st.count("review"):2} in progress  {s}')
if '--next' in sys.argv:
    free = [t for t in order if tasks[t]['status'] == 'todo' and all(tasks.get(d, {}).get('status') == 'done' for d in tasks[t]['needs'])]
    print('\nCan be started now:')
    for t in free:
        print(f'  {t}  {tasks[t]["task"][:100]}')
for p in problems:
    print('PROBLEM ' + p)
print(f'{len(tasks)} tasks, {sum(1 for t in tasks.values() if t["status"] == "done")} done, {len(problems)} problems')
sys.exit(1 if problems else 0)
