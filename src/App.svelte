<script lang="ts">
 import { onMount } from 'svelte';
 import InstallApp from './InstallApp.svelte';
 import { getThemeSettings, updateTheme, type ThemeMode, type ThemeAccent } from './theme';
 import { get, set, queue, save, api, accounts, create, sync, link, linkedNotes, type Account, type Config, type Operation, untransferred, markTransferred, cachedTransfers, saveTransfersCache, removeCachedTransfer, type ReserveTransfer } from './core';
 let tab = 'cash', name = '', amount = '', card = '', linkingCard = '', reserve = '', message = '', busy = false, recording = false;
 let transfers: ReserveTransfer[] = [], transfersLoaded = false, transfersRefreshing = false, transferCacheTime = 0;
 let appearance = getThemeSettings();
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
 $: liabilities = all.filter(a=>['liabilities','liability'].includes(a.attributes.type));
 $: pending = operations.filter(o=>!o.legs.every(l=>l.done));
 function cardLink(a: Account) { try {return link(a.attributes.notes);} catch{return '';} }
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
 function selectTab(id: string) {tab=id;message=''; if(id==='transfers') void loadTransfers();}
 async function synchronize() { await run(async()=>{ const stored = await get<Config>('config'); if(!stored?.token) throw new Error('Save your connection in Settings first.'); await sync(stored); operations=await queue(); message=operations.some(o=>!o.legs.every(l=>l.done)) ? 'Some purchases need attention. See the queue below.' : 'All purchases synced.'; }); }
 onMount(()=>{ void run(async()=>{config=await get<Config>('config') || config; all=await get<Account[]>('accounts') || []; operations=await queue(); if(config.token){await sync(config); operations=await queue();}else tab='settings';}); });
 async function connect(){await run(async()=>{const url=new URL(config.url); if(url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('Use an HTTPS Firefly URL.'); if(url.username || url.password || url.search || url.hash) throw new Error('Use a plain Firefly base URL.'); const next={...config,url:url.href.replace(/\/$/, '')}; const old=await get<Config>('config'); if(old?.url && old.url!==next.url && (await queue()).some(o=>!o.legs.every(l=>l.done))) throw new Error('Sync pending purchases before changing instances.'); const fetched=await accounts(next); if(old?.url!==next.url){next.cash='';} await set('config',next); await set('accounts',fetched); config=next;all=fetched;message='Connected. Accounts refreshed.';});}
 async function preferences(){await run(async()=>{const stored=await get<Config>('config'); if(!stored || stored.url!==config.url || stored.token!==config.token) throw new Error('Connect before saving account preferences.'); if(!assets.some(a=>a.id===config.cash)) throw new Error('Choose a primary cash account.'); await set('config',{...config}); message='Preferences saved on this device.';});}
 async function saveLink(){await run(async()=>{const stored=await get<Config>('config'); if(!stored) throw new Error('Connect first.'); const selected=liabilities.find(a=>a.id===linkingCard); const target=assets.find(a=>a.id===reserve); if(!selected || !target || reserve===stored.cash || selected.attributes.currency_code!==target.attributes.currency_code) throw new Error('Choose a liability and separate savings account in the same currency.'); const fresh=await api(stored,`/accounts/${linkingCard}`); await api(stored,`/accounts/${linkingCard}`,'PUT',{notes:linkedNotes(fresh.data.attributes.notes || '',reserve)}); all=await accounts(stored); await set('accounts',all);message='Card link saved in Firefly.';});}
 async function record(){if(recording)return; recording=true; try{const stored=await get<Config>('config'); if(!stored) throw new Error('Configure Firefly first.'); if(tab==='credit'&&!card) throw new Error('Choose a credit card.'); const op=create(stored,all,name,amount,tab==='credit'?card:''); await save(op); operations=await queue(); name='';amount='';message='Saved on this device.'; if(navigator.onLine) await synchronize();}catch(e){message=String(e);}finally{recording=false;} }
</script>

<svelte:head><meta name="description" content="A simple offline companion for Firefly III"/></svelte:head>
<main>
 <a class="skip-link" href="#workspace">Skip to workspace</a>
 <header><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">f</span><span>firefly<span class="light"> / assist</span></span></a><span class="badge"><span class="status-dot" aria-hidden="true"></span>Offline-ready workspace</span></header>
 <section class="intro"><div class="intro-copy"><p class="eyebrow">YOUR MONEY, IN SYNC</p><h1>Every purchase, <span class="headline-accent">under control.</span></h1><p>Capture spending in seconds, keep card repayments organized, and sync with Firefly whenever you reconnect.</p></div><div class="intro-decoration" aria-hidden="true"><span class="decor-orbit"></span><span class="decor-dot"></span></div></section>
 <div class="workspace" id="workspace">
 <nav aria-label="Main tabs"><span class="nav-label">WORKSPACE</span>{#each [['cash','Cash'],['credit','Credit'],['transfers','Transfers'],['settings','Settings']] as [id,label]}<button class:active={tab===id} aria-current={tab===id ? "page" : undefined} disabled={busy||recording} onclick={()=>selectTab(id)}>{label}</button>{/each}</nav>
 <section class="panel" aria-label="Transaction workspace">
 <div hidden={tab!=='settings'}><InstallApp/><hr/></div>
 {#if tab==='cash' || tab==='credit'}
 <div class="panel-heading"><div><p class="eyebrow">NEW TRANSACTION</p><h2>{tab==='cash'?'Cash purchase':'Credit purchase'}</h2></div><span class="symbol">{tab==='cash'?'↗':'⇄'}</span></div>
 <form onsubmit={(e)=>{e.preventDefault();void record();}}>
 {#if tab==='credit'}<label>Credit card<select bind:value={card} required><option value="">Choose a linked card</option>{#each liabilities.filter(a=>cardLink(a)) as a}<option value={a.id}>{a.attributes.name}</option>{/each}</select></label>{/if}
 <label>Transaction name<input bind:value={name} placeholder="e.g. Groceries" required maxlength="255"/></label>
 <label>Amount <span class="light">{assets.find(a=>a.id===config.cash)?.attributes.currency_code || ''}</span><input class="amount" bind:value={amount} inputmode="decimal" placeholder="0.00" required/></label>
 <p class="hint">{tab==='cash'?'Paid from your primary cash account.':'A reserve transfer is recorded in Firefly. Move the money yourself, then mark it transferred in Transfers.'}</p>
 <button class="primary" disabled={busy||recording}>Save purchase <span>↗</span></button>
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
 <hr/><h3>Credit card savings</h3><p class="hint">Link an existing liability to the asset account holding its repayment money.</p>
 {#each liabilities.filter(a=>cardLink(a)) as a}<p class="mapping">{a.attributes.name} → {assets.find(b=>b.id===cardLink(a))?.attributes.name || 'Missing account'}</p>{/each}
 <label>Credit liability<select bind:value={linkingCard}><option value="">Choose liability</option>{#each liabilities as a}<option value={a.id}>{a.attributes.name}</option>{/each}</select></label>
 <label>Savings account<select bind:value={reserve}><option value="">Choose savings asset</option>{#each assets.filter(a=>a.id!==config.cash) as a}<option value={a.id}>{a.attributes.name}</option>{/each}</select></label>
 <button disabled={busy} onclick={saveLink}>Save link in Firefly</button>
 {/if}
 {#if message}<p class="notice" role="status">{message}</p>{/if}
 </section>
 <section class="queue"><div class="activity-topline"><span class="activity-icon" aria-hidden="true">↻</span><p class="eyebrow">DEVICE ACTIVITY</p></div><div class="queue-heading"><h3>{pending.length ? `${pending.length} waiting to sync` : 'No pending purchases'}</h3><button disabled={busy||recording} onclick={synchronize}>{busy?'Working…':'Sync / retry'}</button></div>
 {#each pending as op}<article><strong>{op.name}</strong><span>{op.amount}</span><p>{op.legs.filter(l=>l.done).length} / {op.legs.length} entries synced</p>{#if op.error}<p class="error">{op.error}</p>{/if}</article>{/each}
 <p class="hint">Pending purchases stay on this device until synced. Keep browser data to retain them.</p></section>
 </div>
 <footer><span>firefly <span class="light">/ assist</span></span><span>Built for a smoother way to stay on top of spending.</span></footer>
</main>
