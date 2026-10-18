import sys, time
from common import *
model = sys.argv[1]; qprefix = sys.argv[2] if len(sys.argv)>2 else ''
embed(model, ['暖機'])
ce, t_doc = embed(model, CHUNKS)
print(f"## {model} dim={len(ce[0])} chunks={len(CHUNKS)} embed_all={t_doc:.2f}s")
top1=top3=0; qt=[]
for q, keys in QUESTIONS:
    (qe,), t = embed(model, [qprefix+q]); qt.append(t)
    ranked = sorted(range(len(CHUNKS)), key=lambda i: -cos(qe, ce[i]))
    h1 = hit(ranked[0], keys); h3 = any(hit(i, keys) for i in ranked[:3])
    top1+=h1; top3+=h3
    print(f"{'✅' if h1 else ('🟡' if h3 else '❌')} {q} | " + ' / '.join(f"{CHUNKS[i].split(chr(10))[0][:22]}({cos(qe,ce[i]):.3f})" for i in ranked[:3]))
print(f"TOP1 {top1}/{len(QUESTIONS)}  TOP3 {top3}/{len(QUESTIONS)}  avg query {sum(qt)/len(qt)*1000:.0f} ms")
