from common import *
import unicodedata
FILL = ["請問","想問","我想","你們","妳們","您們","貴店","一下","可以","嗎","呢","吧","啊","喔","哦","的","是","有沒有","有","會不會","能不能","到","會"]
def norm(t): return ''.join(ch for ch in t.lower() if not (unicodedata.category(ch)[0] in 'PSZ' or ch.isspace()))
def core(t):
    s=norm(t)
    for f in FILL: s=s.replace(f,'')
    return s or norm(t)
def bg(s): return {s[i:i+2] for i in range(len(s)-1)} if len(s)>1 else ({s} if s else set())
def cov(q,t):
    a=bg(q); return len(a&bg(t))/len(a) if a else 0
t1=t3=0
for q,keys in QUESTIONS:
    qq=core(q)
    sc=[cov(qq,core(c))+cov(qq,core(c.split('\n')[0]))*0.5 for c in CHUNKS]
    r=sorted(range(len(CHUNKS)),key=lambda i:-sc[i])
    h1=hit(r[0],keys); h3=any(hit(i,keys) for i in r[:3]); t1+=h1;t3+=h3
    print(('✅' if h1 else '🟡' if h3 else '❌'),q,'|',' / '.join(f"{CHUNKS[i].split(chr(10))[0][:20]}({sc[i]:.2f})" for i in r[:3]))
print(f"BIGRAM TOP1 {t1}/10 TOP3 {t3}/10")
