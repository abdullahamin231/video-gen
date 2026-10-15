# Usage: python3 -I scripts/eval/opencode-trace.py <session-id> [v]  — per-turn tool calls and context size
import json,sqlite3,sys
db=sqlite3.connect('file:/home/abdullah/.local/share/opencode/opencode.db?mode=ro',uri=True)
sid=sys.argv[1]; verbose=len(sys.argv)>2
rows=db.execute("select seq,type,data from session_message where session_id=? order by seq",(sid,)).fetchall()
tot_in=tot_cr=0; turn=0
from collections import Counter
tools=Counter(); outsz=Counter()
for seq,t,data in rows:
  d=json.loads(data)
  if t=='user': print(f"[{seq}] USER: {d.get('text','')[:300]!r}"); continue
  if t!='assistant': continue
  turn+=1
  tk=d.get('tokens') or {}
  ctx=tk.get('input',0)+(tk.get('cache') or {}).get('read',0)
  tot_in+=ctx
  calls=[]
  for c in d['content']:
    if c['type']=='tool':
      st=c.get('state',{}); inp=st.get('input',{})
      out=''.join(x.get('text','') for x in st.get('content',[]) if isinstance(x,dict))
      tools[c['name']]+=1; outsz[c['name']]+=len(out)
      s=inp.get('command') or inp.get('filePath') or inp.get('file_path') or inp.get('description') or json.dumps(inp)[:200]
      if c['name'] in('write','edit'): s=f"{inp.get('filePath')} ({len(json.dumps(inp))}ch)"
      calls.append(f"{c['name']}[{st.get('status')},out={len(out)}]: {str(s)[:220]!r}")
    elif c['type']=='text' and verbose: calls.append("TEXT: "+c['text'][:300].replace('\n',' '))
  print(f"T{turn} ctx={ctx} out={tk.get('output',0)} r={tk.get('reasoning',0)}")
  for x in calls: print("   ",x)
print("TOOLS",tools.most_common()); print("OUTCHARS",outsz.most_common()); print("turns",turn,"sum ctx",tot_in)
