import json, urllib.request, time, math
DOC = open('/Users/hadytang/Mac-Line-Bot/knowledge/ASUS商用筆電-MIL-STD-810H軍規測試.txt', encoding='utf-8').read()
import os
CHUNKS = [p.strip() for p in DOC.split('\n\n') if p.strip()]
if os.environ.get('STRIP'):
    import re as _re
    CHUNKS = [_re.sub(r'（[^）]*）$', '', c.split('\n')[0]).strip() + ('\n' + c.split('\n',1)[1] if '\n' in c else '') for c in CHUNKS]
TITLE = 'ASUS商用筆電-MIL-STD-810H軍規測試'
# question -> list of acceptable chunk indices (by substring of first line)
QUESTIONS = [
 ("溫度衝擊測試怎麼做", ["Method 503.7"]),
 ("摔到地上會壞嗎", ["Bench Handling", "Crash Hazard"]),
 ("B1400 有做沙塵測試嗎", ["Method 510.7", "B1400 B1500 通過", "B1400CBA 通過"]),
 ("P5 可以耐多低溫", ["Cold Climatic", "P5405CSA 通過", "Basic Climatic"]),
 ("筆電可以淋雨嗎", ["Method 507.6"]),
 ("坐飛機帶著沒問題吧", ["Method 500.6"]),
 ("L1400 有沒有做溫度衝擊", ["Method 503.7", "L1 L1400"]),
 ("摔壞了保固有賠嗎", ["注意事項"]),
 ("放在車上曬太陽會怎樣", ["Method 505.7", "Hot Dry"]),
 ("開車載著一直震動可以嗎", ["Method 514.8 振動 Vibration 運輸振動"]),
]
def post(path, body, timeout=600):
    req = urllib.request.Request('http://127.0.0.1:11434'+path, data=json.dumps(body).encode(), headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r: return json.loads(r.read())
def embed(model, texts):
    t=time.time(); r = post('/api/embed', {'model':model,'input':texts, 'keep_alive':'10m'}); return r['embeddings'], time.time()-t
def cos(a,b):
    return sum(x*y for x,y in zip(a,b))/math.sqrt(sum(x*x for x in a)*sum(y*y for y in b))
def hit(idx, keys):
    first = CHUNKS[idx].split('\n')[0]
    return any(k in first for k in keys)
