from common import *
import json
m='quentinz/bge-large-zh-v1.5'; p='为这个句子生成表示以用于检索相关文章：'
ce,_=embed(m,CHUNKS); out={}
for q,_k in QUESTIONS:
    (qe,),_=embed(m,[p+q])
    r=sorted(range(len(CHUNKS)),key=lambda i:-cos(qe,ce[i]))
    ctx='';n=0
    for i in r:
        b=f"【{TITLE}】{CHUNKS[i]}"
        if len(ctx)+len(b)>1800: continue
        ctx+=b+'\n\n'; n+=1
        if n==4: break
    out[q]=ctx.strip()
json.dump(out,open('contexts.json','w'),ensure_ascii=False,indent=1)
print({q:len(c) for q,c in out.items()})
