# Usage: python3 -I scripts/eval/claude-subagents.py [session-id ...]  — agent type, model and brief per Claude Code sub-agent
# With no ids, lists every session of this repo. Checks that roles ran on the model their .claude/agents file pins.
import json,os,sys,glob
root=os.path.expanduser('~/.claude/projects/'+os.getcwd().replace('/','-'))
sids=sys.argv[1:] or sorted(os.path.basename(d) for d in glob.glob(root+'/*') if os.path.isdir(d+'/subagents'))
for sid in sids:
  print(f'session {sid}')
  for f in sorted(glob.glob(f'{root}/{sid}/subagents/*.jsonl'),key=os.path.getmtime):
    lines=[json.loads(l) for l in open(f) if l.strip()]
    meta=json.load(open(f[:-6]+'.meta.json')) if os.path.exists(f[:-6]+'.meta.json') else {}
    models=sorted({l['message'].get('model') for l in lines if l.get('type')=='assistant'})
    prompt=next((l['message']['content'] for l in lines if l.get('type')=='user'),'')
    prompt=prompt if isinstance(prompt,str) else ' '.join(x.get('text','') for x in prompt if isinstance(x,dict))
    brief=next((w.split('/briefs/')[-1].rstrip('.') for w in prompt.split() if '/briefs/' in w),'-')
    print(f"  {meta.get('agentType','?'):16} {','.join(m for m in models if m):20} {brief}")
