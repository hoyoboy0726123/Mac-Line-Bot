import sys,json,time
from common import post
exec(open('qa.py').read().split("qs=[q for")[0].split("CTX=json")[1].split("\n",1)[1])  # loads SYS, SCHEMA
M=[("你好～",'greeting'),("我要找真人客服",'humanAgent'),("明天晚上7點想訂位2位",'reservation'),("謝謝你的說明",'thanks'),("你們回覆超慢，很爛",'complaint'),("B5302C 有做凍融測試嗎",'question')]
for model in sys.argv[1:]:
    ok=0;ts=[]
    for m,exp in M:
        body={'model':model,'messages':[{'role':'system','content':SYS},{'role':'user','content':f"參考資料：\n（沒有資料）\n\n顧客最新訊息：{m}"}],'stream':False,'think':False,'format':SCHEMA,'options':{'temperature':0.2,'num_ctx':8192}}
        t=time.time(); r=post('/api/chat',body); ts.append(time.time()-t)
        j=json.loads(r['message']['content']); ok+= j['intent']==exp
        print(f"  {model} {m} → {j['intent']} ({'✓' if j['intent']==exp else '✗ 應為 '+exp}) | {j['reply'][:60]}")
    print(f"{model}: intent {ok}/{len(M)} avg {sum(ts)/len(ts):.1f}s")
