# Writes the ASCII copies in print/ used by the Unit 8 PDF listings (non-ASCII shown as <U+XXXX>).
import pathlib
here = pathlib.Path(__file__).parent
files = ['src/api.js', 'src/money.js', 'src/time.js', 'src/moneyState.js', 'src/live.js', 'src/i18n.js',
         'src/redirect.js', 'src/messages/en.json', 'container/nginx.conf', 'container/tb/secure-headers.conf']
for f in files:
    t = (here / f).read_text(encoding='utf-8')
    (here / 'print' / f.replace('/', '__')).write_text(
        ''.join(c if ord(c) < 128 else '<U+%04X>' % ord(c) for c in t), encoding='ascii')
