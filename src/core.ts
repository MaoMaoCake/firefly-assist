import { openDB } from 'idb';
export type Account = { id: string; attributes: { name: string; type: string; currency_code: string; currency_decimal_places?: number; current_balance?: string; notes?: string | null; active: boolean } };
export type Config = { url: string; token: string; cash: string };
export type Leg = { payload: Record<string, unknown>; done: boolean; uncertain?: boolean };
export type Operation = { id: string; instance: string; name: string; amount: string; legs: Leg[]; error?: string };
const marker = /\[firefly-assist\]\s*([\s\S]*?)\s*\[\/firefly-assist\]/;
export type CardAccounts = { primary: string; ids: string[] };
export function cardAccounts(notes: string | null | undefined = ''): CardAccounts {
 const m = (notes || '').match(marker);
 if (!m) return { primary: '', ids: [] };
 const data = JSON.parse(m[1]);
 if (data.version !== 1) throw new Error('Unsupported account metadata version');
 const primary = typeof data.linked_asset_account_id === 'string' ? data.linked_asset_account_id : '';
 const ids = Array.isArray(data.linked_asset_account_ids) ? data.linked_asset_account_ids : [];
 if (ids.some((id: unknown) => typeof id !== 'string')) throw new Error('Invalid linked savings account metadata');
 return { primary, ids: [...new Set([primary, ...ids].filter(Boolean))] };
}
export function link(notes: string | null | undefined = ''): string { return cardAccounts(notes).primary; }
export function linkedAccountsNotes(notes: string, primary: string, ids: string[]) {
 cardAccounts(notes);
 if (!primary || !ids.includes(primary) || new Set(ids).size !== ids.length || ids.some(id => !id)) throw new Error('Select a primary account included in linked savings accounts.');
 const block = `[firefly-assist]\n${JSON.stringify({version: 1, linked_asset_account_id: primary, linked_asset_account_ids: ids})}\n[/firefly-assist]`;
 return marker.test(notes) ? notes.replace(marker, block) : `${notes}${notes ? '\n\n' : ''}${block}`;
}
export function linkedNotes(notes: string, id: string) { return linkedAccountsNotes(notes, id, [id]); }
export type CardReport = { card: Account; accounts: Account[]; outstanding: number; reserved: number; difference: number; missing: string[] };
export function reconcileCards(all: Account[]): CardReport[] {
 return all.filter(a => ['liabilities','liability'].includes(a.attributes.type)).flatMap(card => {
  const mapping = cardAccounts(card.attributes.notes);
  if (!mapping.ids.length) return [];
  const savings: Account[] = [], missing: string[] = [];
  for (const id of mapping.ids) {
   const account = all.find(a => a.id === id && a.attributes.type === 'asset' && a.attributes.currency_code === card.attributes.currency_code);
   if (!account || account.attributes.current_balance === undefined || !Number.isFinite(Number(account.attributes.current_balance))) missing.push(id);
   else savings.push(account);
  }
  const cardBalance = Number(card.attributes.current_balance);
  if (card.attributes.current_balance === undefined || !Number.isFinite(cardBalance)) missing.push('Card balance unavailable');
  const outstanding = Math.abs(cardBalance);
  const reserved = savings.reduce((sum, a) => sum + Number(a.attributes.current_balance), 0);
  return [{card, accounts:savings, outstanding, reserved, difference:reserved-outstanding, missing}];
 });
}
const db = () => openDB('firefly-assist', 1, { upgrade(db) { db.createObjectStore('settings'); db.createObjectStore('queue', { keyPath: 'id' }); } });
export async function get<T>(key: string): Promise<T | undefined> { return (await db()).get('settings', key); }
export async function set(key: string, value: unknown) { return (await db()).put('settings', value, key); }
export async function queue(): Promise<Operation[]> { return (await db()).getAll('queue'); }
export async function save(op: Operation) { await (await db()).put('queue', op); }
export async function api(c: Config, path: string, method = 'GET', body?: unknown) {
 const response = await fetch(`${c.url}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
 if (!response.ok) throw new Error(`Firefly ${response.status}: ${ (await response.text()).slice(0, 350) }`);
 return response.json();
}
export async function accounts(c: Config) { const result: Account[] = []; for(let page=1;;page++){const r = await api(c, `/accounts?limit=100&page=${page}`); result.push(...r.data); if(page >= r.meta.pagination.total_pages) break;} return result.filter(a=>a.attributes.active); }
export function create(c: Config, all: Account[], name: string, amount: string, card = ''): Operation {
 if (!name.trim()) throw new Error('Enter a transaction name.');
 const cash = all.find(a=>a.id === c.cash);
 if (!cash || cash.attributes.type !== 'asset') throw new Error('Configure the primary cash account first.');
 const precision = cash.attributes.currency_decimal_places ?? 2;
 if (!/^\d+(\.\d+)?$/.test(amount) || !/[1-9]/.test(amount) || (amount.split('.')[1]?.length ?? 0) > precision) throw new Error(`Enter a positive amount with at most ${precision} decimal places.`);
 const id = crypto.randomUUID(); const date = new Date().toISOString();
 const op: Operation = { id, instance: c.url, name: name.trim(), amount, legs: [] };
 function add(role: string, type: string, source: string, destination?: string) { op.legs.push({done:false, payload:{type, date, amount, description: op.name, currency_code: cash!.attributes.currency_code, source_id:source, ...(destination ? {destination_id:destination} : {}), external_id:`firefly-assist:${id}:${role}`, notes: JSON.stringify({ 'firefly-assist': { version:1, operation_id:id, component:role, ...(role === 'reserve' ? { transferred:false } : {}) } }) }}); }
 if (card) {
 const liability = all.find(a=>a.id===card); const reserve = all.find(a=>a.id===link(liability?.attributes.notes));
 if (!liability || !['liabilities','liability'].includes(liability.attributes.type) || !reserve || reserve.attributes.type !== 'asset' || reserve.id === cash.id) throw new Error('Choose a card linked to a separate savings asset account.');
 if ([liability,reserve].some(a=>a.attributes.currency_code !== cash.attributes.currency_code)) throw new Error('All participating accounts must use the same currency.');
 add('purchase','withdrawal',card); add('reserve','transfer',c.cash,reserve.id);
 } else add('purchase','withdrawal',c.cash);
 return op;
}
export async function syncOperation(c: Config, op: Operation, persist = save, request = api) {
 if(op.instance !== c.url) throw new Error('This purchase belongs to a different Firefly instance.');
 for (const leg of op.legs) {
 if(leg.done) continue;
 const r = await request(c, `/search/transactions?query=${encodeURIComponent(`external_id:"${leg.payload.external_id}"`)}&limit=100`);
 const matches = r.data.flatMap((g: any)=>g.attributes.transactions).filter((t: any)=>t.external_id === leg.payload.external_id);
 if(matches.length){ if(matches.length !== 1 || !sameTransactionNotes(matches[0].notes, leg.payload.notes)) throw new Error('Conflicting transaction metadata. Review in Firefly before retrying.'); leg.done=true; leg.uncertain=false; await persist(op); continue; }
 // An ambiguous POST must never be blindly repeated. A later retry searches again.
 if(leg.uncertain) throw new Error('Creation result is uncertain and not yet found in Firefly. Retry to check again; review in Firefly if this persists.');
 leg.uncertain=true; await persist(op);
 try { await request(c, '/transactions', 'POST', { error_if_duplicate_hash:true, apply_rules:false, fire_webhooks:false, transactions:[leg.payload] }); }
 catch(e) { if(e instanceof Error && /^Firefly (400|401|403|404|422):/.test(e.message)) {leg.uncertain=false; await persist(op);} throw e; }
 leg.done=true; leg.uncertain=false; await persist(op);
 }
}
export async function sync(c: Config) {
 if (!navigator.locks) throw new Error('This browser does not support safe queue locking. Use a current browser.');
 await navigator.locks.request('firefly-assist-sync', async()=>{ for(const op of await queue()) { if(op.legs.every(l=>l.done)) continue; try{await syncOperation(c,op); op.error=undefined;}catch(e){op.error=String(e);} await save(op); } });
}

export type ReserveTransfer = { groupId: string; journalId: string; description: string; amount: string; currency: string; date: string; source: string; destination: string; legacy: boolean };
export function transactionMetadata(notes: unknown) {
 if(typeof notes !== 'string') return null;
 try { const data=JSON.parse(notes); const meta=data?.['firefly-assist'];
 if(meta?.version !== 1 || typeof meta.operation_id !== 'string' || !['purchase','reserve'].includes(meta.component)) return null;
 return { data, meta };
 } catch { return null; }
}
export function sameTransactionNotes(actual: unknown, expected: unknown) {
 if(actual === expected) return true;
 const a=transactionMetadata(actual), b=transactionMetadata(expected);
 if(!a || !b || a.meta.component !== 'reserve' || b.meta.component !== 'reserve') return false;
 // Completion is mutable; operation identity must still match during reconciliation.
 for(const entry of [a,b]) {if(entry.meta.transferred !== undefined && typeof entry.meta.transferred !== 'boolean') return false; delete entry.meta.transferred;}
 return JSON.stringify(a.data) === JSON.stringify(b.data);
}
// Cache is scoped to the Firefly URL and a SHA-256 fingerprint of the PAT.
export async function transferCacheKey(c: Config): Promise<string> {
 const bytes = new TextEncoder().encode(`${c.url}\0${c.token}`);
 const digest = await crypto.subtle.digest('SHA-256', bytes);
 return 'transfers:' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export type TransferSnapshot = { items: ReserveTransfer[]; updatedAt: number };
export async function cachedTransfers(c: Config): Promise<TransferSnapshot | undefined> {
 return get<TransferSnapshot>(await transferCacheKey(c));
}
export async function saveTransfersCache(c: Config, items: ReserveTransfer[]): Promise<void> {
 await set(await transferCacheKey(c), { items, updatedAt: Date.now() } satisfies TransferSnapshot);
}
export async function removeCachedTransfer(c: Config, item: ReserveTransfer): Promise<void> {
 const cached = await cachedTransfers(c);
 if (!cached) return;
 await saveTransfersCache(c, cached.items.filter(t => t.groupId !== item.groupId || t.journalId !== item.journalId));
}
export async function untransferred(c: Config, request = api): Promise<ReserveTransfer[]> {
 const result: ReserveTransfer[] = [];
 function collect(r: any) {
  for (const group of r.data) for (const t of group.attributes.transactions) {
   const parsed = transactionMetadata(t.notes);
   if (t.type !== 'transfer' || parsed?.meta.component !== 'reserve' || (parsed.meta.transferred !== false && parsed.meta.transferred !== undefined)) continue;
   result.push({groupId:group.id,journalId:t.transaction_journal_id,description:t.description,amount:t.amount,currency:t.currency_code,date:t.date,source:t.source_name,destination:t.destination_name,legacy:parsed.meta.transferred === undefined});
  }
 }
 const first = await request(c, '/transactions?type=transfer&limit=100&page=1');
 collect(first);
 const pages = first.meta?.pagination?.total_pages ?? 1;
 // Bounded parallel fetches preserve pagination order while reducing latency.
 for (let start = 2; start <= pages; start += 4) {
  const end = Math.min(pages, start + 3);
  const batch = await Promise.all(Array.from({ length: end - start + 1 }, (_, i) =>
   request(c, `/transactions?type=transfer&limit=100&page=${start+i}`)));
  for (const r of batch) collect(r);
 }
 return result;
}

export async function markTransferred(c: Config, item: ReserveTransfer, request = api) {
 // Fetch current notes first to retain other metadata and make repeated clicks safe.
 const r=await request(c,`/transactions/${item.groupId}`);
 const t=r.data.attributes.transactions.find((t: any)=>t.transaction_journal_id === item.journalId);
 const parsed=transactionMetadata(t?.notes);
 if(!t || t.type !== 'transfer' || parsed?.meta.component !== 'reserve') throw new Error('This transfer no longer has valid companion metadata. Refresh the list.');
 if(parsed.meta.transferred === true) return;
 parsed.meta.transferred=true;
 await request(c,`/transactions/${item.groupId}`,'PUT',{apply_rules:false,fire_webhooks:false,transactions:r.data.attributes.transactions.map((split: any)=>({transaction_journal_id:split.transaction_journal_id,notes:split.transaction_journal_id === item.journalId ? JSON.stringify(parsed.data) : split.notes}))});
}
