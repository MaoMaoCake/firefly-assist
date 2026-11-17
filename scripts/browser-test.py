"""Local-only browser integration test. Requires a connected Docker browser.
Creates labeled dummy ledger entries and retains them for inspection.
"""
import json,time,uuid
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
D=json.loads((Path(__file__).resolve().parent.parent / '.env.firefly-user.json').read_text());run='E2E '+uuid.uuid4().hex[:8]; checks=[]
def http(url,body=None,method=None,headers={}):
 r=Request(url,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json',**headers},method=method)
 try:
  with urlopen(r,timeout=40) as f:return json.load(f)
 except HTTPError as e:raise RuntimeError(str(e.code)+' '+e.read().decode()[:1000])
def api(path,body=None):return http('http://localhost:8081/api/v1'+path,body,headers={'Authorization':'Bearer '+D['token'],'Accept':'application/json'})
def wd(path,body=None):return http('http://localhost:4444'+path,body)['value']
s=next(slot['session']['sessionId'] for n in wd('/status')['nodes'] for slot in n['slots'] if slot.get('session'));base='/session/'+s
E='element-6066-11e4-a52e-4f735466cecf'
def js(script,args=[]):return wd(base+'/execute/sync',{'script':script,'args':args})
def el(x):return wd(base+'/element',{'using':'xpath','value':x})[E]
def click(x):
 for i in range(60):
  try:
   e=el(x)
   if wd(base+'/element/'+e+'/enabled'):wd(base+'/element/'+e+'/click',{});return
  except RuntimeError:pass
  time.sleep(.25)
 raise AssertionError('Cannot click '+x)
def fill(x,v):
 p=base+'/element/'+el(x);wd(p+'/clear',{});wd(p+'/value',{'text':v})
def wait(text):
 for i in range(100):
  if text in js('return document.body.innerText'):return
  time.sleep(.2)
 raise AssertionError('Missing '+text+'; page: '+js('return document.body.innerText')[-1500:])
def tab(t):click('//nav/button[normalize-space(.)="'+t+'"]')
def select(label,id):click('//label[contains(.,"'+label+'")]/select/option[@value="'+id+'"]')
def passed(t):checks.append(t);print('PASS',t,flush=True)
def transactions():
 return [t for g in api('/transactions?limit=100')['data'] for t in g['attributes']['transactions'] if t['description'].startswith(run)]
accounts=api('/accounts')['data']
def account(name,extra):
 a=next((a for a in accounts if a['attributes']['name']==name),None)
 return a or api('/accounts',{'name':name,'currency_code':'USD','active':True,**extra})['data']
reserve=account('Audit Reserve',{'type':'asset','account_role':'savingAsset'})
card=account('Audit Card',{'type':'liabilities','liability_type':'debt','liability_direction':'credit','interest':'0','interest_period':'monthly','opening_balance':'0','opening_balance_date':'2026-11-17'})
# Remove stale app shell cache only from this disposable browser, then reload current build.
wd(base+'/execute/async',{'script':'const done=arguments[arguments.length-1]; Promise.all([navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister()))),caches.keys().then(ks=>Promise.all(ks.map(k=>caches.delete(k))))]).then(()=>done(true));','args':[]})
wd(base+'/url',{'url':'http://localhost:8080'});wait('Cash purchase');tab('Settings')
click('//button[contains(.,"Connect & refresh accounts")]');wait('Connected. Accounts refreshed.')
select('Credit liability',card['id']);select('Savings account',reserve['id']);click('//button[normalize-space(.)="Save link in Firefly"]');wait('Card link saved in Firefly.')
passed('Link credit card to reserve through UI')
def purchase(label,amount='0.01'):
 fill('//input[@placeholder="e.g. Groceries"]',run+' '+label);fill('//input[@placeholder="0.00"]',amount);click('//button[contains(.,"Save purchase")]')
tab('Cash');purchase('cash');wait('All purchases synced.');ts=transactions();assert len(ts)==1 and ts[0]['type']=='withdrawal' and ts[0]['source_id']==D['cash'];passed('Cash purchase writes one correct withdrawal')
purchase('invalid','0');wait('Enter a positive amount');assert len(transactions())==1;passed('Zero amount rejected without API write')
tab('Credit');select('Credit card',card['id']);purchase('credit');wait('All purchases synced.');ts=transactions();assert len(ts)==3
credit=[t for t in ts if t['description']==run+' credit'];assert {t['type'] for t in credit}=={'withdrawal','transfer'}
transfer=next(t for t in credit if t['type']=='transfer');assert transfer['source_id']==D['cash'] and transfer['destination_id']==reserve['id'];assert next(t for t in credit if t['type']=='withdrawal')['source_id']==card['id'];passed('Credit purchase creates withdrawal and cash-to-reserve transfer')
click('//button[normalize-space(.)="Sync / retry"]');wait('All purchases synced.');assert len(transactions())==3;passed('Manual retry does not duplicate synced entries')
tab('Transfers');wait(run+' credit');click('//article[strong[normalize-space(.)="'+run+' credit"]]/button');wait('Marked as transferred.');ts=transactions();assert len(ts)==3;assert json.loads(next(t for t in ts if t['type']=='transfer')['notes'])['firefly-assist']['transferred'] is True;passed('Mark transferred updates existing notes without a new entry')
# Browser-level offline emulation; WebDriver control remains available.
def offline(value):wd(base+'/goog/cdp/execute',{'cmd':'Network.emulateNetworkConditions','params':{'offline':value,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1}})
tab('Cash');offline(True)
try:
 purchase('offline');wait('Saved on this device.');wait('1 waiting to sync');assert len(transactions())==3;passed('Offline purchase is queued without server write')
finally:offline(False)
click('//button[normalize-space(.)="Sync / retry"]');wait('All purchases synced.');assert len(transactions())==4;passed('Reconnect syncs queued purchase exactly once')
wd(base+'/refresh',{});wait('Cash purchase');click('//button[normalize-space(.)="Sync / retry"]');wait('All purchases synced.');assert len(transactions())==4;passed('Reload and retry preserve completed state without duplicates')
Path('/tmp/firefly-e2e-results.json').write_text(json.dumps({'run':run,'checks':checks,'transactions':4},indent=2));print('RESULT',run,len(checks),'checks passed; 4 dummy ledger entries retained.')
