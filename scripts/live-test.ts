import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { api, accounts, create, linkedNotes, syncOperation, type Config } from '../src/core.ts';
// Readline writes keystrokes to this sink instead of echoing the credential.
const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
process.stdout.write('Demo PAT (hidden): ');
const rl = createInterface({ input: process.stdin, output: sink, terminal: true });
const token = await rl.question('');
rl.close();
process.stdout.write('\n');
const c:Config={url:'https://fire.jirapongpansak.com',token,cash:''};
const list=await accounts(c);
console.log('Accounts',list.map(a=>({id:a.id,name:a.attributes.name,type:a.attributes.type,currency:a.attributes.currency_code})));
for(const origin of ['http://localhost:5173','https://firefly-assist.example.com']){
 const r=await fetch(c.url+'/api/v1/accounts',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization,content-type'}});
 console.log('CORS',origin,r.status,Object.fromEntries([...r.headers].filter(([k])=>k.startsWith('access-control'))));
}

const cash=list.find(a=>a.attributes.name==='CASH ACCOUNT' && a.attributes.type==='asset')!;
const card=list.find(a=>a.attributes.name==='CREDIT CARD' && a.attributes.type==='liabilities')!;
if(!cash || !card) throw new Error('Expected demo accounts missing');
async function ensure(name:string,type:string){const existing=list.find(a=>a.attributes.name===name);if(existing)return existing;const r=await api(c,'/accounts','POST',{name,type,currency_code:cash.attributes.currency_code,...(type==='asset'?{account_role:'savingAsset'}:{})});list.push(r.data);return r.data;}
const reserve=await ensure('Firefly Assist TEST Reserve','asset');
c.cash=cash.id;
const notes=linkedNotes(card.attributes.notes || '',reserve.id);
await api(c,`/accounts/${card.id}`,'PUT',{notes});card.attributes.notes=notes;
for(const selected of ['',card.id]){
 const op=create(c,list,`Firefly Assist TEST ${selected?'credit':'cash'} ${new Date().toISOString()}`,'0.01',selected);
 let posts=0;const request:typeof api=async(config,path,method,body)=>{if(method==='POST')posts++;return api(config,path,method,body);};
 await syncOperation(c,op,async()=>{},request);
 console.log('Created',op.name,'operation',op.id,'legs',op.legs.length);
 // Simulate loss of every acknowledgement after server acceptance.
 for(const leg of op.legs){leg.done=false;leg.uncertain=true;}
 await syncOperation(c,op,async()=>{},request);
 if(posts!==op.legs.length || !op.legs.every(l=>l.done))throw new Error('Retry reconciliation failed');
 console.log('Reconciled without duplicate POSTs:',posts);
 for(const leg of op.legs){const r=await api(c,`/search/transactions?query=${encodeURIComponent(`external_id:"${leg.payload.external_id}"`)}`); console.log('Verified',r.data.map((g:any)=>({id:g.id,transactions:g.attributes.transactions.map((t:any)=>({type:t.type,source:t.source_name,destination:t.destination_name,amount:t.amount,external_id:t.external_id}))})));}
}
for(const method of ['POST','PUT']){const r=await fetch(c.url+'/api/v1/accounts',{method:'OPTIONS',headers:{Origin:'http://localhost:5173','Access-Control-Request-Method':method,'Access-Control-Request-Headers':'authorization,content-type'}});console.log('CORS',method,r.status,r.headers.get('access-control-allow-methods'));}
console.log('Live demo integration passed');
