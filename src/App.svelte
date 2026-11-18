<script lang="ts">
 import { onMount } from 'svelte';
 import InstallApp from './InstallApp.svelte';
 import { getThemeSettings, updateTheme, type ThemeMode, type ThemeAccent } from './theme';
 import { get, set, queue, save, api, accounts, create, createReimbursement, sync, link, cardAccounts, linkedAccountsNotes, reconcileCards, isReserveAccount, reserveBalance, type CardReport, type Account, type Config, type Operation, untransferred, markTransferred, cachedTransfers, saveTransfersCache, removeCachedTransfer, type ReserveTransfer } from './core';
 let tab = 'cash', name = '', amount = '', card = '', linkingCard = '', reserve = '', selectedReserves: string[] = [], message = '', busy = false, recording = false;
 let transfers: ReserveTransfer[] = [], transfersLoaded = false, transfersRefreshing = false, transferCacheTime = 0;
 let appearance = getThemeSettings();
 let reports: CardReport[] = [], reportsLoaded = false, reportsRefreshing = false, reportTransfers: ReserveTransfer[] = [];
 const accents: { id: ThemeAccent; label: string }[] = [
  { id: 'cyan', label: 'Cyan · brand' }, { id: 'forest', label: 'Forest' }, { id: 'purple', label: 'Purple' },
  { id: 'blue', label: 'Blue' }, { id: 'teal', label: 'Teal' },
  { id: 'orange', label: 'Orange' }, { id: 'rose', label: 'Rose' },
 ];
 function chooseMode(mode: ThemeMode) { appearance = { ...appearance, mode }; updateTheme(appearance); }
 function chooseAccent(accent: ThemeAccent) { appearance = { ...appearance, accent }; updateTheme(appearance); }
 let config: Config = {url:'',token:'',cash:''};
 let all: Account[] = [], operations: Operation[] = [];
 $: assets = all.filter(a=>a.attributes.type==='asset');
 $: liabilities = all.filter(a=>['liabilities','liability'].includes(a.attributes.type) && a.attributes.liability_direction !== 'credit');
 $: reserveOptions = all.filter(isReserveAccount);
 $: pending = operations.filter(o=>!o.legs.every(l=>l.done));
 function cardLink(a: Account) { try {return link(a.attributes.notes);} catch{return '';} }
 function selectCardLink(id: string) {
  linkingCard=id;
  const selected=liabilities.find(a=>a.id===id);
  const mapping=cardAccounts(selected?.attributes.notes);
  selectedReserves=[...mapping.ids];
  reserve=mapping.primary;
 }
 function toggleReserve(id: string, checked: boolean) {
  selectedReserves=checked ? [...selectedReserves,id] : selectedReserves.filter(x=>x!==id);
  if(!selectedReserves.includes(reserve)) reserve=selectedReserves.find(id=>assets.some(a=>a.id===id)) || '';
 }
 function currency(value: number, code: string) { return `${code} ${value.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
 async function loadReports() {
  if(reportsRefreshing) return;
  const stored=await get<Config>('config');
  if(!stored?.token) {message='Connect to Firefly in Settings first.'; return;}
  reportsRefreshing=true; reportsLoaded=false; message='';
  try {
   if(!navigator.onLine) throw new Error('An internet connection is required for current account balances.');
   const fresh=await accounts(stored);
   all=fresh; await set('accounts',fresh);
   reports=reconcileCards(fresh);
   // Pending physical transfers are separate from the balance comparison.
   const cached=await cachedTransfers(stored);
   reportTransfers=cached?.items ?? [];
   try {
    const pending=await untransferred(stored);
    reportTransfers=pending;
    await saveTransfersCache(stored,pending);
   } catch {message='Balances refreshed, but pending transfers could not be refreshed. Showing cached transfer status.';}
   reportsLoaded=true;
  } catch(e) {message=e instanceof Error?e.message:String(e);}
  finally {reportsRefreshing=false;}
 }
 async function run(action: ()=>Promise<void>) {busy=true; message=''; try{await action();}catch(e){message=e instanceof Error ? e.message : String(e);}finally{busy=false;} }
 async function loadTransfers() {
  if (transfersRefreshing) return;
  message = '';
  const stored = await get<Config>('config');
  if (!stored?.token) { message = 'Connect to Firefly in Settings first.'; return; }
  // Render an IndexedDB snapshot before network pagination begins.
  try {
   const cached = await cachedTransfers(stored);
   transfers = cached?.items ?? [];
   transfersLoaded = true;
   transferCacheTime = cached?.updatedAt ?? 0;
  } catch (e) { message = `Could not read transfer cache: ${String(e)}`; }
  if (!navigator.onLine) { message = 'Offline: showing saved transfers. Status may be outdated.'; return; }
  transfersRefreshing = true;
  try {
   const fresh = await untransferred(stored);
   await saveTransfersCache(stored, fresh);
   transfers = fresh;
   transferCacheTime = Date.now();
   transfersLoaded = true;
  } catch (e) { message = `Could not refresh transfers; showing last saved list. ${String(e)}`; }
  finally { transfersRefreshing = false; }
 }
 async function completeTransfer(item: ReserveTransfer) {
  await run(async()=>{
   const stored=await get<Config>('config');
   if(!stored?.token) throw new Error('Connect to Firefly first.');
   await markTransferred(stored,item);
   transfers=transfers.filter(t=>t.groupId!==item.groupId || t.journalId!==item.journalId);
   await removeCachedTransfer(stored,item);
   message='Marked as transferred.';
  });
 }
 function selectTab(id: string) {tab=id;message=''; if(id==='transfers') void loadTransfers(); if(id==='reports') void loadReports();}
 async function synchronize() { await run(async()=>{ const stored = await get<Config>('config'); if(!stored?.token) throw new Error('Save your connection in Settings first.'); await sync(stored); operations=await queue(); message=operations.some(o=>!o.legs.every(l=>l.done)) ? 'Some purchases need attention. See the queue below.' : 'All purchases synced.'; }); }
 onMount(()=>{ void run(async()=>{config=await get<Config>('config') || config; all=await get<Account[]>('accounts') || []; operations=await queue(); if(config.token){await sync(config); operations=await queue();}else tab='settings';}); });
 async function connect(){await run(async()=>{const url=new URL(config.url); if(url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('Use an HTTPS Firefly URL.'); if(url.username || url.password || url.search || url.hash) throw new Error('Use a plain Firefly base URL.'); const next={...config,url:url.href.replace(/\/$/, '')}; const old=await get<Config>('config'); if(old?.url && old.url!==next.url && (await queue()).some(o=>!o.legs.every(l=>l.done))) throw new Error('Sync pending purchases before changing instances.'); const fetched=await accounts(next); if(old?.url!==next.url){next.cash='';} await set('config',next); await set('accounts',fetched); config=next;all=fetched;message='Connected. Accounts refreshed.';});}
 async function preferences(){await run(async()=>{const stored=await get<Config>('config'); if(!stored || stored.url!==config.url || stored.token!==config.token) throw new Error('Connect before saving account preferences.'); if(!assets.some(a=>a.id===config.cash)) throw new Error('Choose a primary cash account.'); await set('config',{...config}); message='Preferences saved on this device.';});}
 async function saveLink(){await run(async()=>{
  const stored=await get<Config>('config'); if(!stored) throw new Error('Connect first.');
  const selected=liabilities.find(a=>a.id===linkingCard);
  if(!selected || !reserve || !assets.some(a=>a.id===reserve) || !selectedReserves.includes(reserve) || !selectedReserves.length) throw new Error('Choose a card, linked savings accounts and a primary account.');
  for(const id of selectedReserves) {
   const target=reserveOptions.find(a=>a.id===id);
   if(!target || id===stored.cash || selected.attributes.currency_code!==target.attributes.currency_code) throw new Error('Linked accounts must be separate from cash, be assets or amounts owed to you, and use the card currency.');
   if(liabilities.some(a=>a.id!==selected.id && cardAccounts(a.attributes.notes).ids.includes(id))) throw new Error('A savings account is already assigned to another card; its whole balance cannot be reconciled twice.');
  }
  const fresh=await api(stored,`/accounts/${linkingCard}`);
  await api(stored,`/accounts/${linkingCard}`,'PUT',{notes:linkedAccountsNotes(fresh.data.attributes.notes || '',reserve,selectedReserves)});
  all=await accounts(stored); await set('accounts',all);message='Card savings accounts saved in Firefly.';
 });}
 async function record(){if(recording)return; recording=true; try{const stored=await get<Config>('config'); if(!stored) throw new Error('Configure Firefly first.'); if(tab==='credit'&&!card) throw new Error('Choose a credit card.'); const op=tab==='reimburse' ? createReimbursement(stored,all,name,amount) : create(stored,all,name,amount,tab==='credit'?card:''); await save(op); operations=await queue(); name='';amount='';message='Saved on this device.'; if(navigator.onLine) await synchronize();}catch(e){message=String(e);}finally{recording=false;} }
</script>

<svelte:head><meta name="description" content="A simple offline companion for Firefly III"/></svelte:head>
<main>
 <a class="skip-link" href="#workspace">Skip to workspace</a>
 <header><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">f</span><span>firefly<span class="light"> / assist</span></span></a><span class="badge"><span class="status-dot" aria-hidden="true"></span>Offline-ready workspace</span></header>
 <section class="intro"><div class="intro-copy"><p class="eyebrow">YOUR MONEY, IN SYNC</p><h1>Every purchase, <span class="headline-accent">under control.</span></h1><p>Capture spending in seconds, keep card repayments organized, and sync with Firefly whenever you reconnect.</p></div><div class="intro-decoration" aria-hidden="true"><span class="decor-orbit"></span><span class="decor-dot"></span></div></section>
 <div class="workspace" id="workspace">
 <nav aria-label="Main tabs"><span class="nav-label">WORKSPACE</span>{#each [['cash','Cash'],['credit','Credit'],['reimburse','Reimburse'],['transfers','Transfers'],['reports','Reports'],['settings','Settings']] as [id,label]}<button class:active={tab===id} aria-current={tab===id ? "page" : undefined} disabled={busy||recording} onclick={()=>selectTab(id)}>{label}</button>{/each}</nav>
 <section class="panel" aria-label="Transaction workspace">
 <div hidden={tab!=='settings'}><InstallApp/><hr/></div>
 {#if tab==='cash' || tab==='credit' || tab==='reimburse'}
 <div class="panel-heading"><div><p class="eyebrow">NEW TRANSACTION</p><h2>{tab==='cash'?'Cash purchase':tab==='credit'?'Credit purchase':'Reimbursement'}</h2></div><span class="symbol">{tab==='credit'?'⇄':tab==='reimburse'?'↙':'↗'}</span></div>
 <form onsubmit={(e)=>{e.preventDefault();void record();}}>
 {#if tab==='credit'}<label>Credit card<select bind:value={card} required><option value="">Choose a linked card</option>{#each liabilities.filter(a=>cardLink(a)) as a}<option value={a.id}>{a.attributes.name}</option>{/each}</select></label>{/if}
 <label>Transaction name<input bind:value={name} placeholder={tab==='reimburse' ? 'e.g. Dinner paid back by Alex' : 'e.g. Groceries'} required maxlength="255"/></label>
 <label>Amount <span class="light">{assets.find(a=>a.id===config.cash)?.attributes.currency_code || ''}</span><input class="amount" bind:value={amount} inputmode="decimal" placeholder="0.00" required/></label>
 <p class="hint">{tab==='cash'?'Paid from your primary cash account.':tab==='reimburse'?'One deposit into your primary cash account. No savings transfer or credit-card adjustment.':'A reserve transfer is recorded in Firefly. Move the money yourself, then mark it transferred in Transfers.'}</p>
 <button class="primary" disabled={busy||recording}>{tab==='reimburse'?'Save reimbursement':'Save purchase'} <span>↗</span></button>
 </form>
 {:else if tab==='transfers'}
 <div class="queue-heading"><h2>To transfer</h2><button disabled={busy||transfersRefreshing} onclick={loadTransfers}>{transfersRefreshing?'Refreshing…':'Refresh'}</button></div>
 <p class="hint">Move this money from cash to savings in your bank, then mark it transferred here. This updates the existing Firefly record.</p>
 {#if transferCacheTime}<p class="hint">Saved list: {new Date(transferCacheTime).toLocaleString()}. Refresh to check for updates on other devices.</p>{/if}
 {#if !transfersLoaded}<p class="hint">Connect to load your pending transfers.</p>
 {:else if transfers.length===0}<p>No transfers waiting.</p>{/if}
 {#each transfers as transfer (`${transfer.groupId}:${transfer.journalId}`)}
 <article class="transfer-item"><strong>{transfer.description}</strong><span>{transfer.currency} {transfer.amount}</span>
 <p>{transfer.source} → {transfer.destination}</p><p>{new Date(transfer.date).toLocaleDateString()}</p>
 {#if transfer.legacy}<p class="hint">Older transfer — completion not yet recorded.</p>{/if}
 <button disabled={busy||transfersRefreshing||!navigator.onLine} onclick={()=>completeTransfer(transfer)}>Mark transferred</button></article>
 {/each}
 <p class="hint">Transfers are saved on this device for quick viewing, including offline. Internet is required to refresh and mark transfers; saved statuses may be outdated. Purchases waiting to sync will appear after they sync.</p>
 {:else if tab==='reports'}
 <div class="queue-heading"><h2>Card reconciliation</h2><button disabled={reportsRefreshing||busy} onclick={loadReports}>{reportsRefreshing?'Refreshing…':'Refresh'}</button></div>
 <p class="hint">Compare each linked credit-card liability against the combined current Firefly balances of its savings accounts. Only linked cards are shown. Refresh online for current balances.</p>
 {#if !reportsLoaded}<p class="hint">{reportsRefreshing?'Loading account balances and pending transfers…':'Refresh to load your card balances.'}</p>
 {:else if reports.length===0}<p>No linked credit cards found.</p>
 {:else}
 {#each reports as report (report.card.id)}
 <article class="transfer-item">
  <div class="queue-heading"><strong>{report.card.attributes.name}</strong><strong>{report.missing.length?'Incomplete':Math.abs(report.difference)<0.005?'Matched':report.difference<0?'Shortfall':'Excess'}</strong></div>
  <p>Outstanding: {currency(report.outstanding,report.card.attributes.currency_code)} · Reserved: {currency(report.reserved,report.card.attributes.currency_code)}</p>
  <p><strong>Difference: {currency(report.difference,report.card.attributes.currency_code)}</strong></p>
  {#if report.missing.length}<p class="error">Missing or invalid balances/accounts: {report.missing.join(', ')}. Difference is not reliable.</p>{/if}
  <details><summary>Linked savings breakdown</summary>
   {#each report.accounts as account (account.id)}
   <p>{account.attributes.name}: {currency(reserveBalance(account),account.attributes.currency_code)}</p>
   {/each}
  </details>
 </article>
 {/each}
 {/if}
 <hr/><h3>Pending physical transfers</h3>
 <p class="hint">Shown separately; amounts are already recorded in Firefly and are not added to reconciliation totals.</p>
 {#if reportTransfers.length===0}<p>No pending physical transfers in the latest available snapshot.</p>{/if}
 {#each reportTransfers as item (`${item.groupId}:${item.journalId}`)}
 <article class="transfer-item"><strong>{item.description}</strong><p>{item.source} → {item.destination} · {item.currency} {item.amount}</p></article>
 {/each}
 {:else}
 <p class="eyebrow">CONNECTION</p><h2>Connect to Firefly III</h2><p class="hint">Connect once, then record purchases wherever you are.</p>
 <label>Firefly III URL<input bind:value={config.url} placeholder="https://firefly.example.com" type="url"/></label>
 <label>Personal access token<input bind:value={config.token} type="password" autocomplete="off"/></label><p class="hint">Stored in this browser. Your Firefly server must allow this app’s origin through CORS.</p>
 <button disabled={busy} onclick={connect}>Connect & refresh accounts</button>
 <hr/><section class="appearance" aria-label="Appearance settings">
 <h3>Appearance</h3><p class="hint">Follow the system light/dark mode or choose a palette for this device. Browsers cannot read Android wallpaper colors directly.</p>
 <div class="appearance-modes" role="group" aria-label="Color mode">
 {#each [['system','System'],['light','Light'],['dark','Dark']] as [id,label]}
 <button type="button" class:selected={appearance.mode===id} aria-pressed={appearance.mode===id} onclick={()=>chooseMode(id as ThemeMode)}>{label}</button>
 {/each}
 </div>
 <p class="appearance-label">Accent color</p>
 <div class="appearance-accents" role="group" aria-label="Accent color">
 {#each accents as accent}
 <button type="button" class="accent-choice" class:selected={appearance.accent===accent.id} data-color={accent.id} aria-label={accent.label} aria-pressed={appearance.accent===accent.id} title={accent.label} onclick={()=>chooseAccent(accent.id)}><span aria-hidden="true">{appearance.accent===accent.id?'✓':''}</span></button>
 {/each}
 </div>
 </section>
 <hr/><h3>Primary cash account</h3>
 <label>Primary cash account<select bind:value={config.cash}><option value="">Choose an asset account</option>{#each assets as a}<option value={a.id}>{a.attributes.name}</option>{/each}</select></label>
 <button disabled={busy} onclick={preferences}>Save preferences</button>
 <hr/><h3>Credit card savings</h3><p class="hint">Link savings assets and liabilities marked “I am owed this amount” for reconciliation. Keep a savings asset as primary for automatic purchase reserve transfers.</p>
 {#each liabilities.filter(a=>cardLink(a)) as a}<p class="mapping">{a.attributes.name} → {cardAccounts(a.attributes.notes).ids.map(id=>reserveOptions.find(b=>b.id===id)?.attributes.name || 'Missing account').join(', ')} (primary: {assets.find(b=>b.id===cardLink(a))?.attributes.name || 'Missing account'})</p>{/each}
 <label>Credit liability<select value={linkingCard} onchange={(e)=>selectCardLink(e.currentTarget.value)}><option value="">Choose liability</option>{#each liabilities as a}<option value={a.id}>{a.attributes.name}</option>{/each}</select></label>
 {#if linkingCard}
 <fieldset class="account-picker"><legend>Linked accounts</legend>
 <p class="hint">Select all accounts that should count toward this card's reconciliation.</p>
 <div class="account-options">
 {#each reserveOptions.filter(a=>a.id!==config.cash && a.attributes.currency_code===liabilities.find(c=>c.id===linkingCard)?.attributes.currency_code) as a (a.id)}
 <label class="account-option" class:is-selected={selectedReserves.includes(a.id)}>
  <input class="account-option-input" type="checkbox" checked={selectedReserves.includes(a.id)} onchange={(e)=>toggleReserve(a.id,e.currentTarget.checked)}/>
  <span class="account-option-copy"><span class="account-option-name">{a.attributes.name}</span><span class="account-option-type">{a.attributes.type==='asset'?'Savings asset':'Owed to me'}</span></span>
  <span class="account-option-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg></span>
 </label>
 {/each}
 </div>
 </fieldset>
 <label>Primary savings account (receives new purchase reserves)<select bind:value={reserve}><option value="">Choose primary</option>{#each assets.filter(a=>selectedReserves.includes(a.id)) as a}<option value={a.id}>{a.attributes.name}</option>{/each}</select></label>
 <button disabled={busy||!reserve} onclick={saveLink}>Save links in Firefly</button>
 {/if}
 {/if}
 {#if message}<p class="notice" role="status">{message}</p>{/if}
 </section>
 <section class="queue"><div class="activity-topline"><span class="activity-icon" aria-hidden="true">↻</span><p class="eyebrow">DEVICE ACTIVITY</p></div><div class="queue-heading"><h3>{pending.length ? `${pending.length} waiting to sync` : 'No pending purchases'}</h3><button disabled={busy||recording} onclick={synchronize}>{busy?'Working…':'Sync / retry'}</button></div>
 {#each pending as op}<article><strong>{op.name}</strong><span>{op.amount}</span><p>{op.legs.filter(l=>l.done).length} / {op.legs.length} entries synced</p>{#if op.error}<p class="error">{op.error}</p>{/if}</article>{/each}
 <p class="hint">Pending purchases stay on this device until synced. Keep browser data to retain them.</p></section>
 </div>
 <footer><span>firefly <span class="light">/ assist</span></span><span>Built for a smoother way to stay on top of spending.</span></footer>
</main>
