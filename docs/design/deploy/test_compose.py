#!/usr/bin/env python3
"""Checks of the Compose files and Dockerfiles (Unit 9). Uses Docker Compose's own parser
(`docker compose config`), so no daemon and no images are needed.

usage: python3 test_compose.py REPO_ROOT
  REPO_ROOT contains backend/, frontend/, docs/design/deploy/ and docs/design/web/container/
"""
import json, re, subprocess, sys, tempfile, pathlib

root = pathlib.Path(sys.argv[1]).resolve()
dep = root / 'docs/design/deploy'
base = ['docker', 'compose', '-f', str(dep / 'docker-compose.yml'), '--project-directory', str(root)]
prod = base[:4] + ['-f', str(dep / 'docker-compose.prod.yml')] + base[4:]
passed = failed = 0

def check(label, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('PASS  ' + label)
    else: failed += 1; print('FAIL  ' + label + (': ' + detail if detail else ''))

def render(cmd, env_file=None):
    c = cmd + (['--env-file', env_file] if env_file else []) + ['config', '--format', 'json']
    r = subprocess.run(c, capture_output=True, text=True, env={'PATH': '/usr/bin:/bin:/usr/local/bin', 'HOME': '/tmp'})
    return r.returncode, (json.loads(r.stdout) if r.returncode == 0 else None), r.stderr

rc, dev, err = render(base)
check('the development file is valid Compose with no settings at all (one command, NFR-MNT-08)', rc == 0, err[:200])
S = dev['services']
long_running = sorted(n for n, s in S.items() if s.get('restart') != 'no')
check('four long-running containers: postgres, redis, backend, web (NFR-MNT-01)',
      long_running == ['backend', 'postgres', 'redis', 'web'], str(long_running))
check('migrate is a one-shot job that the backend waits for',
      S['migrate'].get('restart') == 'no' and S['backend']['depends_on']['migrate']['condition'] == 'service_completed_successfully')
check('the backend waits for healthy postgres and redis (NFR-MNT-01)',
      all(S['backend']['depends_on'][d]['condition'] == 'service_healthy' for d in ('postgres', 'redis')))
check('every long-running container has a health check (NFR-OBS-01)', all('healthcheck' in S[n] for n in long_running))
published = {n: s.get('ports', []) for n, s in S.items() if s.get('ports')}
check('only the web container publishes a port', list(published) == ['web'], str(published))
check('postgres and redis are only on the internal network (SEC-INF-02)',
      dev['networks']['data'].get('internal') is True
      and all(set(S[n]['networks']) == {'data'} for n in ('postgres', 'redis')))
check('the web container is not on the data network, so it cannot reach the database',
      'data' not in S['web']['networks'])
check('redis requires a password', '--requirepass' in ' '.join(S['redis']['command']))
check('postgres stores passwords as SCRAM', 'scram-sha-256' in S['postgres']['environment']['POSTGRES_INITDB_ARGS'])
check('the backend connects as tb_app and the migrations as tb_owner (SEC-INF-03)',
      '//tb_app:' in S['backend']['environment']['DATABASE_URL'] and '//tb_owner:' in S['migrate']['environment']['DATABASE_URL'])
for n in ('backend', 'web', 'redis', 'migrate'):
    s = S[n]
    check(f'{n}: read-only root file system, all capabilities dropped, no privilege escalation (SEC-INF-01)',
          s.get('read_only') is True and s.get('cap_drop') == ['ALL'] and 'no-new-privileges:true' in s.get('security_opt', []))
check('logs of every long-running container are rotated (DV-62)',
      all(S[n].get('logging', {}).get('driver') == 'local' and S[n]['logging']['options'].get('max-size') for n in long_running))
check('the backend has 30 seconds to finish requests on shutdown (DV-66)', S['backend'].get('stop_grace_period') == '30s')
vols = {n: [v['source'] for v in s.get('volumes', []) if v.get('type') == 'volume'] for n, s in S.items()}
files = ['kyc_files', 'listing_media', 'proof_files', 'chat_media', 'evidence_files', 'export_files']
check('one volume per file purpose, mounted only in the backend',
      sorted(vols['backend']) == sorted(files) and not any(f in vols[n] for n in S if n != 'backend' for f in files))
check('the init script is mounted read-only', any(v.get('target') == '/docker-entrypoint-initdb.d' and v.get('read_only')
                                                  for v in S['postgres']['volumes']))
secrets = ['JWT_KEY_V1', 'FIELD_KEY_V1', 'BIDX_KEY', 'KYC_KEK_V1', 'CSRF_KEY', 'LINK_KEY', 'OTP_PEPPER', 'CALLBACK_STATE_KEY', 'HANDOVER_KEY']
env = S['backend']['environment']
check('development secrets are at least 32 bytes and marked dev-only (SEC-DAT-05, I-59)',
      all(len(env[k]) >= 32 and env[k].startswith('dev-only-') for k in secrets))

# ---------------------------------------------------------------- production override
rc, _, err = render(prod)
check('production refuses to render while a secret is missing', rc != 0 and 'required variable' in err, err[:120])
tmp = pathlib.Path(tempfile.mkdtemp())
example = (dep / 'prod.env.example').read_text()
keys = re.findall(r'^([A-Z0-9_]+)=', example, re.M)
filled = '\n'.join(f'{k}=prod-value-{k.lower()}-0123456789abcdef0123' if k not in ('PAYMENT_MODE', 'COURIER_MODE', 'SMS_MODE',
                   'PUBLIC_ORIGIN', 'TB_VERSION', 'TB_HTTP_PORT', 'VITE_PAYMENT_HOSTS') else
                   {'PAYMENT_MODE': 'PAYMENT_MODE=sandbox', 'COURIER_MODE': 'COURIER_MODE=mock', 'SMS_MODE': 'SMS_MODE=log',
                    'PUBLIC_ORIGIN': 'PUBLIC_ORIGIN=https://trustbazaar.example', 'TB_VERSION': 'TB_VERSION=1.0.0',
                    'TB_HTTP_PORT': 'TB_HTTP_PORT=8080', 'VITE_PAYMENT_HOSTS': 'VITE_PAYMENT_HOSTS='}[k] for k in keys)
(tmp / 'prod.env').write_text(filled + '\n')
rc, pr, err = render(prod, str(tmp / 'prod.env'))
check('production renders once every value in prod.env.example is filled', rc == 0, err[:200])
if pr:
    text = json.dumps(pr)
    check('no development value survives in production', 'dev-only-' not in text)
    check('production runs with NODE_ENV=production (SEC-INF-05)',
          all(pr['services'][n]['environment']['NODE_ENV'] == 'production' for n in ('backend', 'migrate')))
    p = pr['services']['web']['ports']
    check('in production the web port listens on the loopback only, behind the TLS front',
          len(p) == 1 and p[0].get('host_ip') == '127.0.0.1', str(p))
required = sorted(set(re.findall(r'\$\{([A-Z0-9_]+):\?', (dep / 'docker-compose.prod.yml').read_text())))
check('prod.env.example lists every value production requires', not [k for k in required if k not in keys],
      str([k for k in required if k not in keys]))

# ---------------------------------------------------------------- Dockerfiles
for name in ('backend.Dockerfile', 'web.Dockerfile'):
    t = (dep / name).read_text()
    stages = re.findall(r'^FROM\s+(\S+)', t, re.M)
    users = re.findall(r'^USER\s+(\S+)', t, re.M)
    check(f'{name}: two stages, so build tools stay out of the image', len(stages) == 2, str(stages))
    check(f'{name}: base images are minimal (alpine) and pinned to a major version',
          all(re.search(r':\d+(\.\d+)?-alpine$', s) for s in stages), str(stages))
    check(f'{name}: the image runs as a non-root user', bool(users) and users[-1] not in ('root', '0'), str(users))
print(f'\n{passed} checks passed, {failed} failed ({subprocess.run(["docker", "compose", "version", "--short"], capture_output=True, text=True).stdout.strip()})')
sys.exit(1 if failed else 0)
