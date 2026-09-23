#!/usr/bin/env python3
"""Extract / rebuild the HASC LMS self-unpacking bundle.

  python3 tools/bundle.py extract <bundle.html> <template.html>
  python3 tools/bundle.py build   <bundle.html> <template.html> <out.html>

The bundle stores the app document as a JSON string inside
<script type="__bundler/template">. build() swaps only that JSON payload and
leaves the loader prefix/suffix, manifest and ext_resources byte-identical.
"""
import json, re, sys

TPL = re.compile(r'(<script type="__bundler/template">)(.*?)(</script>)', re.S)

def split(bundle):
    m = TPL.search(bundle)
    if not m:
        sys.exit('template script not found')
    return bundle[:m.start(2)], m.group(2), bundle[m.end(2):]

def encode(text):
    # ASCII-only JSON; escape every "</" so no </script> (or </style> etc.) can
    # terminate the carrier <script> early.
    return json.dumps(text, ensure_ascii=True).replace('</', '<\\/')

def main():
    cmd = sys.argv[1]
    bundle = open(sys.argv[2], encoding='utf-8').read()
    pre, payload, post = split(bundle)
    if cmd == 'extract':
        open(sys.argv[3], 'w', encoding='utf-8').write(json.loads(payload))
    elif cmd == 'build':
        tpl = open(sys.argv[3], encoding='utf-8').read()
        enc = encode(tpl)
        assert json.loads(enc) == tpl, 'round-trip mismatch'
        assert '</script' not in enc.lower()
        open(sys.argv[4], 'w', encoding='utf-8').write(pre + enc + post)
        print('built', sys.argv[4], len(pre + enc + post), 'bytes')
    else:
        sys.exit(__doc__)

if __name__ == '__main__':
    main()
