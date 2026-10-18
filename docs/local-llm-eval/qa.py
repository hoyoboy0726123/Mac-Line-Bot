import sys, json, time, subprocess
from common import *
model=sys.argv[1]; think = (sys.argv[2]=='think') if len(sys.argv)>2 else False
CTX=json.load(open('contexts.json'))
SYS="""你是「華碩商用筆電小幫手」的 LINE 官方帳號客服。
語氣親切有禮。不要使用表情符號。
規則：
1. 先在「參考資料」中找出跟問題有關的內容，再用這些內容回答。資料有寫的就要具體回答，不要說沒有資料。
2. 顧客問「可不可以、會不會壞、能不能用」這類問題時，不要回答沒有資訊，而是說明資料中相關的測試或規格條件（數字照抄），讓顧客自己判斷；不要保證一定不會壞。
3. 參考資料完全沒有相關內容時，才說目前沒有這項資訊；絕對不可以編造資料以外的價格、規格、時間、地址、活動或承諾。
4. 每個數字、條件都要跟它所屬的型號或項目對應，不可以把 A 型號的資料說成 B 型號的；資料寫「沒有」某項測試時，就直接回答沒有。
5. 一律使用繁體中文，回覆在 150 字以內。
6. 不要提到你是 AI 模型，不要說「根據資料」「參考資料」，也不要提到文件標題。
7. 不處理退款、法律、醫療等需要店家判斷的事情。
輸出 JSON：intent（question/reservation/humanAgent/greeting/thanks/complaint/other）、evidence（從參考資料原文摘錄相關句子，沒有則空字串）、reply（給顧客的回覆）。"""
SCHEMA={"type":"object","properties":{"intent":{"type":"string","enum":["question","reservation","humanAgent","greeting","thanks","complaint","other"]},"evidence":{"type":"string"},"reply":{"type":"string"}},"required":["intent","evidence","reply"]}
qs=[q for q,_ in QUESTIONS]
if len(sys.argv)>3: qs=qs[:int(sys.argv[3])]
# warm up
t=time.time(); post('/api/chat',{'model':model,'messages':[{'role':'user','content':'hi'}],'think':False,'stream':False,'keep_alive':'15m','options':{'num_predict':1}}); print(f"# {model} think={think} cold load {time.time()-t:.1f}s")
rows=[]
for q in qs:
    prompt=f"參考資料：\n{CTX[q]}\n\n顧客最新訊息：{q}"
    body={'model':model,'messages':[{'role':'system','content':SYS},{'role':'user','content':prompt}],'stream':False,'think':think,'format':SCHEMA,'keep_alive':'15m','options':{'temperature':0.2,'num_ctx':8192}}
    t=time.time(); r=post('/api/chat',body); wall=time.time()-t
    c=r['message']['content']
    try: j=json.loads(c); ok=True
    except Exception: j={'reply':c}; ok=False
    pp=r.get('prompt_eval_count',0)/(r.get('prompt_eval_duration',1)/1e9); tg=r.get('eval_count',0)/(r.get('eval_duration',1)/1e9)
    row=dict(q=q,wall=round(wall,2),ptok=r.get('prompt_eval_count'),pp=round(pp),gtok=r.get('eval_count'),tg=round(tg,1),json=ok,thinking=len(r['message'].get('thinking','') or ''),intent=j.get('intent'),evidence=j.get('evidence'),reply=j.get('reply'))
    rows.append(row)
    print(f"[{wall:.1f}s pp={row['ptok']}tok@{row['pp']}/s gen={row['gtok']}tok@{row['tg']}/s json={ok} think_chars={row['thinking']}] {q}\n  → {row['reply']}\n")
ps=subprocess.run(['ollama','ps'],capture_output=True,text=True).stdout; print(ps)
json.dump(rows,open(f"qa_{model.replace(':','_').replace('/','_')}_{'think' if think else 'nothink'}.json",'w'),ensure_ascii=False,indent=1)
