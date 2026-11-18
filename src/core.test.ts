import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create, createReimbursement, link, cardAccounts, linkedAccountsNotes, reconcileCards, isReserveAccount, reserveBalance, linkedNotes, syncOperation, type Account, type Config } from './core';
const c: Config={url:'https://example.test',token:'test',cash:'1'};
const all: Account[]=[['1','asset'],['2','expense'],['3','liabilities'],['4','asset']].map(([id,type])=>({id,attributes:{name:id,type,currency_code:'USD',active:true,notes:id==='3'?linkedNotes('My notes','4'):''}}));
test('account metadata preserves user notes and updates existing link',()=>{const notes=linkedNotes('Personal notes','4');assert.equal(link(notes),'4');assert.equal(link(linkedNotes(notes,'5')),'5');assert.ok(linkedNotes(notes,'5').startsWith('Personal notes'));});
test('credit purchase creates matching liability expense and cash reserve legs',()=>{const op=create(c,all,'Coffee','10.25','3');assert.equal(op.legs.length,2);assert.equal(op.legs[0].payload.source_id,'3');assert.equal(op.legs[0].payload.destination_name,undefined);assert.equal(op.legs[0].payload.destination_id,undefined);assert.equal(op.legs[1].payload.source_id,'1');assert.equal(op.legs[1].payload.destination_id,'4');assert.notEqual(op.legs[0].payload.external_id,op.legs[1].payload.external_id);});
test('rejects zero and currency mismatch',()=>{assert.throws(()=>create(c,all,'Coffee','0'));const copy=structuredClone(all);copy[3].attributes.currency_code='EUR';assert.throws(()=>create(c,copy,'Coffee','1','3'));});
test('partial success retries only missing component',async()=>{const op=create(c,all,'Coffee','1','3');op.legs[0].done=true;let posts=0;await syncOperation(c,op,async()=>{},async(_c,_p,method)=>{if(method==='POST'){posts++;return {};}return {data:[]};});assert.equal(posts,1);assert.ok(op.legs.every(l=>l.done));});
test('lost POST response reconciles without another POST',async()=>{const op=create(c,all,'Coffee','1');let posts=0;await assert.rejects(syncOperation(c,op,async()=>{},async(_c,_p,method)=>{if(method==='POST'){posts++;throw new Error('timeout');}return {data:[]};}));await syncOperation(c,op,async()=>{},async()=>({data:[{attributes:{transactions:[op.legs[0].payload]}}]}));assert.equal(posts,1);assert.ok(op.legs[0].done);});
test('uncertain missing transaction is not blindly retried',async()=>{const op=create(c,all,'Coffee','1');op.legs[0].uncertain=true;await assert.rejects(syncOperation(c,op,async()=>{},async()=>({data:[]})),/uncertain/);});

test('cash purchase needs no expense account in the cached accounts',()=>{const op=create(c,all.filter(a=>a.attributes.type!=='expense'),'Coffee','1');assert.equal(op.legs[0].payload.destination_name,undefined);assert.equal(op.legs[0].payload.description,'Coffee');assert.equal(op.legs[0].payload.destination_id,undefined);});

import { untransferred, markTransferred, transactionMetadata, type ReserveTransfer } from './core';
test('only reserve legs start with transferred false',()=>{const op=create(c,all,'Coffee','1','3');assert.equal(transactionMetadata(op.legs[0].payload.notes)?.meta.transferred,undefined);assert.equal(transactionMetadata(op.legs[1].payload.notes)?.meta.transferred,false);});
const reserveNotes=(transferred?:boolean)=>JSON.stringify({'firefly-assist':{version:1,operation_id:'op',component:'reserve',...(transferred===undefined?{}:{transferred})},personal:'Keep this'});
const split=(id:string,notes:string)=>({transaction_journal_id:id,type:'transfer',description:'Coffee',amount:'1.00',currency_code:'USD',date:'2026-11-16',source_name:'Cash',destination_name:'Savings',notes});
test('pending list reads all pages and excludes completed and unrelated transfers',async()=>{let page=0;const result=await untransferred(c,async()=>{page++;return {data:[{id:String(page),attributes:{transactions:page===1?[split('1',reserveNotes(false)),split('2',reserveNotes(true)),split('3','unrelated')]:[split('4',reserveNotes())]}}],meta:{pagination:{total_pages:2}}};});assert.equal(page,2);assert.deepEqual(result.map(t=>t.journalId),['1','4']);assert.equal(result[1].legacy,true);});
const item:ReserveTransfer={groupId:'10',journalId:'1',description:'Coffee',amount:'1',currency:'USD',date:'2026-11-16',source:'Cash',destination:'Savings',legacy:false};
test('mark updates notes in place, preserves other metadata and sibling splits, and is repeatable',async()=>{let puts=0;let transactions=[split('1',reserveNotes(false)),split('2','Other split notes')];const request=async(_c:Config,path:string,method?:string,body?:any)=>{assert.equal(path,'/transactions/10');if(method){assert.equal(method,'PUT');puts++;assert.equal(body.apply_rules,false);assert.equal(body.transactions.length,2);transactions=transactions.map((t,i)=>({...t,...body.transactions[i]}));}return {data:{attributes:{transactions}}};};await markTransferred(c,item,request);assert.equal(transactionMetadata(transactions[0].notes)?.meta.transferred,true);assert.equal(JSON.parse(transactions[0].notes).personal,'Keep this');assert.equal(transactions[1].notes,'Other split notes');await markTransferred(c,item,request);assert.equal(puts,1);});
test('reconciliation accepts transfer completion after lost acknowledgement',async()=>{const op=create(c,all,'Coffee','1','3');op.legs[0].done=true;const leg=op.legs[1];leg.uncertain=true;const data=JSON.parse(String(leg.payload.notes));data['firefly-assist'].transferred=true;await syncOperation(c,op,async()=>{},async(_c,_path,method)=>{assert.equal(method,undefined);return {data:[{attributes:{transactions:[{...leg.payload,notes:JSON.stringify(data)}]}}]};});assert.ok(leg.done);});
test('failed marking propagates for manual retry',async()=>{await assert.rejects(markTransferred(c,item,async(_c,_p,method)=>{if(method)throw new Error('Offline');return {data:{attributes:{transactions:[split('1',reserveNotes(false))]}}};}),/Offline/);});

test('parallel transfer refresh retains page ordering', async () => {
 const result = await untransferred(c, async (_c, path) => {
  const page = Number(new URL('https://example.test' + path).searchParams.get('page'));
  if (page === 2) await new Promise(resolve => setTimeout(resolve, 15));
  return {data:[{id:String(page),attributes:{transactions:[split(String(page),reserveNotes(false))]}}],meta:{pagination:{total_pages:5}}};
 });
 assert.deepEqual(result.map(t => t.journalId), ['1','2','3','4','5']);
});

test('legacy metadata remains primary and only account',()=>{
 const old='[firefly-assist]\\n{"version":1,"linked_asset_account_id":"4"}\\n[/firefly-assist]'.replaceAll('\\n','\n');
 assert.deepEqual(cardAccounts(old),{primary:'4',ids:['4']});
});
test('multiple savings accounts preserve notes and route purchases to primary',()=>{
 const notes=linkedAccountsNotes('User note','5',['4','5']);
 assert.deepEqual(cardAccounts(notes),{primary:'5',ids:['5','4']});
 assert.ok(notes.startsWith('User note'));
 const copy=structuredClone(all);
 copy.push({id:'5',attributes:{name:'Second reserve',type:'asset',currency_code:'USD',active:true,current_balance:'4.00'}});
 copy[2].attributes.notes=notes;
 const op=create(c,copy,'Coffee','3','3');
 assert.equal(op.legs[1].payload.destination_id,'5');
});
test('reconciliation sums linked balances and excludes unlinked cards',()=>{
 const copy=structuredClone(all);
 copy[2].attributes.current_balance='-15.00';
 copy[2].attributes.notes=linkedAccountsNotes('','4',['4','5']);
 copy[3].attributes.current_balance='10.00';
 copy.push({id:'5',attributes:{name:'Secondary',type:'asset',currency_code:'USD',active:true,current_balance:'4.00'}});
 copy.push({id:'6',attributes:{name:'Unlinked card',type:'liabilities',currency_code:'USD',active:true,current_balance:'-20.00'}});
 const reports=reconcileCards(copy);
 assert.equal(reports.length,1);
 assert.equal(reports[0].outstanding,15);
 assert.equal(reports[0].reserved,14);
 assert.equal(reports[0].difference,-1);
 assert.equal(reports[0].accounts.length,2);
});
test('missing linked account is not silently reported matched',()=>{
 const copy=structuredClone(all);
 copy[2].attributes.current_balance='-10';
 copy[3].attributes.current_balance='10';
 copy[2].attributes.notes=linkedAccountsNotes('','4',['4','missing']);
 const report=reconcileCards(copy)[0];
 assert.deepEqual(report.missing,['missing']);
});

test('owed-to-me credit liabilities can be linked for reconciliation but cannot be the primary reserve',()=>{
 const copy=structuredClone(all);
 copy[2].attributes.current_balance='-15.00';
 copy[2].attributes.notes=linkedAccountsNotes('','4',['4','7']);
 copy[3].attributes.current_balance='10.00';
 copy.push({id:'7',attributes:{name:'Money owed to me',type:'liabilities',currency_code:'USD',liability_direction:'credit',current_balance:'-5.00',active:true}});
 assert.equal(isReserveAccount(copy[4]),true);
 const reports=reconcileCards(copy);
 assert.equal(reports.length,1);
 assert.equal(reports[0].reserved,15);
 assert.equal(reports[0].difference,0);
 assert.equal(reserveBalance(copy[4]),5);
 assert.equal(create(c,copy,'Coffee','1','3').legs[1].payload.destination_id,'4');
});
test('debt liabilities are not eligible repayment accounts',()=>{
 const debt:Account={id:'8',attributes:{name:'Debt',type:'liabilities',currency_code:'USD',liability_direction:'debit',active:true,current_balance:'-5'}};
 assert.equal(isReserveAccount(debt),false);
});


test('reimbursement is a single deposit into the primary account, never a reserve transfer', () => {
 const op = createReimbursement(c, all, 'Dinner paid back by Alex', '12.50');
 assert.equal(op.legs.length, 1);
 const payload = op.legs[0].payload;
 assert.equal(payload.type, 'deposit');
 assert.equal(payload.destination_id, '1');
 assert.equal(payload.source_name, 'Reimbursement');
 assert.equal(payload.source_id, undefined);
 assert.equal(payload.destination_name, undefined);
 assert.equal(payload.amount, '12.50');
 assert.equal(payload.currency_code, 'USD');
 assert.equal(payload.description, 'Dinner paid back by Alex');
 assert.match(String(payload.external_id), /:reimbursement$/);
 assert.equal(transactionMetadata(payload.notes)?.meta.component, 'reimbursement');
 assert.equal(transactionMetadata(payload.notes)?.meta.transferred, undefined);
});
test('reimbursements reject invalid amounts and missing primary accounts', () => {
 assert.throws(() => createReimbursement(c, all, 'Repayment', '0'), /positive amount/);
 assert.throws(() => createReimbursement(c, all, 'Repayment', '1.001'), /decimal places/);
 assert.throws(() => createReimbursement({...c, cash: 'missing'}, all, 'Repayment', '1'), /primary cash account/);
});
test('reimbursement sync posts exactly one deposit and deduplicates retry', async () => {
 const op = createReimbursement(c, all, 'Repayment', '25');
 let posts = 0;
 await syncOperation(c, op, async () => {}, async (_c, _path, method, body: any) => {
  if (method === 'POST') {
   posts++;
   assert.equal(body.transactions.length, 1);
   assert.equal(body.transactions[0].type, 'deposit');
   assert.equal(body.transactions[0].destination_id, c.cash);
  }
  return { data: [] };
 });
 await syncOperation(c, op, async () => {}, async () => { throw new Error('Completed operation should not contact server'); });
 assert.equal(posts, 1);
 assert.ok(op.legs[0].done);
});
test('reimbursement lost acknowledgement can be reconciled by external ID', async () => {
 const op = createReimbursement(c, all, 'Repayment', '5');
 op.legs[0].uncertain = true;
 let posts = 0;
 await syncOperation(c, op, async () => {}, async (_c, _path, method) => {
  if (method === 'POST') posts++;
  return { data: [{attributes:{transactions:[op.legs[0].payload]}}] };
 });
 assert.equal(posts, 0);
 assert.equal(op.legs[0].done, true);
});
