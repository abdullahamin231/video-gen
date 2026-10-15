# Usage: python3 -I scripts/eval/opencode-stats.py <session-id> [...]  — turns, tokens, tools, errors per opencode session
import json,sqlite3,sys
from collections import Counter
db=sqlite3.connect('file:/home/abdullah/.local/share/opencode/opencode.db?mode=ro',uri=True)
for sid in sys.argv[1:]:
  rows=db.execute("select seq,type,data from session_message where session_id=? order by seq",(sid,)).fetchall()
  turn=0; tools=Counter(); errs=[]; firstwrite=None; ctxsum=0; skills=[]; reads=Counter(); maxctx=0; renders=0; checks=0; imgs=0;user=''
  for seq,t,data in rows:
    d=json.loads(data)
    if t=='user' and not user: user=d.get('text','')[:200]
    if t!='assistant': continue
    turn+=1; tk=d.get('tokens') or {}; c=tk.get('input',0)+(tk.get('cache') or {}).get('read',0); ctxsum+=c; maxctx=max(maxctx,c)
    for x in d['content']:
      if x['type']!='tool': continue
      n=x['name']; st=x.get('state',{}); inp=st.get('input',{}); tools[n]+=1
      out=''.join(y.get('text','') for y in st.get('content',[]) if isinstance(y,dict))
      cmd=str(inp.get('command',''))
      if n in('write','edit') and firstwrite is None: firstwrite=turn
      if n=='skill': skills.append(inp.get('id') or inp.get('name'))
      if n=='read':
        p=str(inp.get('path') or inp.get('filePath'));
        if p.endswith('.png') or p.endswith('.jpg'): imgs+=1
        else: reads[p.split('video-gen/')[-1][:70]]+=1
      if 'render' in cmd and 'npm' in cmd: renders+=1
      if 'check' in cmd and 'npm' in cmd: checks+=1
      bad = st.get('status')=='error' or any(k in out[-400:] for k in ('video: ','Error:','error TS','exited 1','command not found','No such file'))
      if bad: errs.append(f"T{turn} {n}: {(cmd or json.dumps(inp))[:110]!r} -> {out[-160:]!r}")
  print("=====",sid, "|", user.replace('\n',' '))
  print(f"turns={turn} firstWriteTurn={firstwrite} ctxSum={ctxsum} maxCtx={maxctx} renders={renders} checks={checks} imageReads={imgs}")
  print("tools",tools.most_common()); print("skills",skills)
  print("reads",[r for r in reads.most_common(25)])
  print("errors(%d):"%len(errs)); [print("  ",e.replace('\\n',' ')) for e in errs[:25]]
