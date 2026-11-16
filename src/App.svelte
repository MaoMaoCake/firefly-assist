<script lang="ts">
 import { onMount } from 'svelte';
 import InstallApp from './InstallApp.svelte';
 import { get, set, queue, save, api, accounts, create, sync, link, linkedNotes, type Account, type Config, type Operation, untransferred, markTransferred, type ReserveTransfer } from './core';
 let tab = 'cash', name = '', amount = '', card = '', linkingCard = '', reserve = '', message = '', busy = false, recording = false;
 let transfers: ReserveTransfer[] = [], transfersLoaded = false;
 let config: Config = {url:'',token:'',cash:''};
 let all: Account[] = [], operations: Operation[] = [];
 $: assets = all.filter(a=>a.attributes.type==='asset');
 $: liabilities = all.filter(a=>['liabilities','liability'].includes(a.attributes.type));
 $: pending = operations.filter(o=>!o.legs.every(l=>l.done));
 function cardLink(a: Account) { try {return link(a.attributes.notes);} catch{return '';} }
 async function run(action: ()=>Promise<void>) {busy=true; message=''; try{await action();}catch(e){message=e instanceof Error ? e.message : String(e);}finally{busy=false;} }
 async function loadTransfers() { await run(async()=>{transfersLoaded=false; transfers=[]; const stored=await get<Config>('config'); if(!stored?.token) throw new Error('Connect to Firefly in Settings first.'); transfers=await untransferred(stored); transfersLoaded=true;}); }
 async function completeTransfer(item: ReserveTransfer) {await run(async()=>{const stored=await get<Config>('config'); if(!stored?.token) throw new Error('Connect to Firefly first.'); await markTransferred(stored,item); transfers=transfers.filter(t=>t.groupId!==item.groupId || t.journalId!==item.journalId); message='Marked as transferred.';});}
 function selectTab(id: string) {tab=id;message=''; if(id==='transfers') void loadTransfers();}
 async function synchronize() { await run(async()=>{ const stored = await get<Config>('config'); if(!stored?.token) throw new Error('Save your connection in Settings first.'); await sync(stored); operations=await queue(); message=pending.length ? 'Some purchases need attention. See the queue below.' : 'All purchases synced.'; }); }
 onMount(()=>{ void run(async()=>{config=await get<Config>('config') || config; all=await get<Account[]>('accounts') || []; operations=await queue(); if(config.token){await sync(config); operations=await queue();}else tab='settings';}); });
 async function connect(){await run(async()=>{const url=new URL(config.url); if(url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('Use an HTTPS Firefly URL.'); if(url.username || url.password || url.search || url.hash) throw new Error('Use a plain Firefly base URL.'); const next={...config,url:url.href.replace(/\/$/, '')}; const old=await get<Config>('config'); if(old?.url && old.url!==next.url && (await queue()).some(o=>!o.legs.every(l=>l.done))) throw new Error('Sync pending purchases before changing instances.'); const fetched=await accounts(next); if(old?.url!==next.url){next.cash='';} await set('config',next); await set('accounts',fetched); config=next;all=fetched;message='Connected. Accounts refreshed.';});}
 async function preferences(){await run(async()=>{const stored=await get<Config>('config'); if(!stored || stored.url!==config.url || stored.token!==config.token) throw new Error('Connect before saving account preferences.'); if(!assets.some(a=>a.id===config.cash)) throw new Error('Choose a primary cash account.'); await set('config',{...config}); message='Preferences saved on this device.';});}
 async function saveLink(){await run(async()=>{const stored=await get<Config>('config'); if(!stored) throw new Error('Connect first.'); const selected=liabilities.find(a=>a.id===linkingCard); const target=assets.find(a=>a.id===reserve); if(!selected || !target || reserve===stored.cash || selected.attributes.currency_code!==target.attributes.currency_code) throw new Error('Choose a liability and separate savings account in the same currency.'); const fresh=await api(stored,`/accounts/${linkingCard}`); await api(stored,`/accounts/${linkingCard}`,'PUT',{notes:linkedNotes(fresh.data.attributes.notes || '',reserve)}); all=await accounts(stored); await set('accounts',all);message='Card link saved in Firefly.';});}
 async function record(){if(recording)return; recording=true; try{const stored=await get<Config>('config'); if(!stored) throw new Error('Configure Firefly first.'); if(tab==='credit'&&!card) throw new Error('Choose a credit card.'); const op=create(stored,all,name,amount,tab==='credit'?card:''); await save(op); operations=await queue(); name='';amount='';message='Saved on this device.'; if(navigator.onLine) await synchronize();}catch(e){message=String(e);}finally{recording=false;} }
</script>

<svelte:head><meta name="description" content="A simple offline companion for Firefly III"/></svelte:head>
<main>
 <a class="skip-link" href="#workspace">Skip to workspace</a>
 <header><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">f</span><span>firefly<span class="light"> / assist</span></span></a><span class="badge">Saved on your device</span></header>
 <section class="intro"><p class="eyebrow">FIREFLY III COMPANION</p><h1>Your spending workspace</h1><p>Record purchases, set aside repayments, and keep Firefly up to date.</p></section>
 <div class="workspace" id="workspace">
 <nav aria-label="Main tabs">{#each [['cash','Cash'],['credit','Credit'],['transfers','Transfers'],['settings','Settings']] as [id,label]}<button class:active={tab===id} aria-current={tab===id ? "page" : undefined} disabled={busy||recording} onclick={()=>selectTab(id)}>{label}</button>{/each}</nav>
 <section class="panel" aria-label="Transaction workspace">
 {#if tab==='cash' || tab==='credit'}
 <div class="panel-heading"><div><p class="eyebrow">{tab==='cash'?'NEW TRANSACTION':'NEW TRANSACTION'}</p><h2>{tab==='cash'?'Cash purchase':'Credit purchase'}</h2></div><span class="symbol">{tab==='cash'?'↗':'⇄'}</span></div>
 <form onsubmit={(e)=>{e.preventDefault();void record();}}>
 {#if tab==='credit'}<label>Credit card<select bind:value={card} required><option value="">Choose a linked card</option>{#each liabilities.filter(a=>cardLink(a)) as a}<option value={a.id}>{a.attributes.name}</option>{/each}</select></label>{/if}
 <label>Transaction name<input bind:value={name} placeholder="e.g. Groceries" required maxlength="255"/></label>
 <label>Amount <span class="light">{assets.find(a=>a.id===config.cash)?.attributes.currency_code || ''}</span><input class="amount" bind:value={amount} inputmode="decimal" placeholder="0.00" required/></label>
 <p class="hint">{tab==='cash'?'Paid from your primary cash account.':'A reserve transfer is recorded in Firefly. Move the money yourself, then mark it transferred in Transfers.'}</p>
 <button class="primary" disabled={busy||recording}>Save purchase <span>↗</span></button>
 </form>
 {:else if tab==='transfers'}
 <div class="queue-heading"><h2>To transfer</h2><button disabled={busy} onclick={loadTransfers}>{busy?'Loading…':'Refresh'}</button></div>
 <p class="hint">Move this money from cash to savings in your bank, then mark it transferred here. This updates the existing Firefly record.</p>
 {#if !transfersLoaded}<p class="hint">Connect to load your pending transfers.</p>
 {:else if transfers.length===0}<p>No transfers waiting.</p>{/if}
 {#each transfers as transfer (`${transfer.groupId}:${transfer.journalId}`)}
 <article class="transfer-item"><strong>{transfer.description}</strong><span>{transfer.currency} {transfer.amount}</span>
 <p>{transfer.source} → {transfer.destination}</p><p>{new Date(transfer.date).toLocaleDateString()}</p>
 {#if transfer.legacy}<p class="hint">Older transfer — completion not yet recorded.</p>{/if}
 <button disabled={busy} onclick={()=>completeTransfer(transfer)}>Mark transferred</button></article>
 {/each}
 <p class="hint">An internet connection is needed to load and mark transfers. Purchases waiting to sync will appear after they sync.</p>
 {:else}
 <p class="eyebrow">CONNECTION</p><h2>Connect to Firefly III</h2><p class="hint">Connect once, then record purchases wherever you are.</p>
 <label>Firefly III URL<input bind:value={config.url} placeholder="https://firefly.example.com" type="url"/></label>
 <label>Personal access token<input bind:value={config.token} type="password" autocomplete="off"/></label><p class="hint">Stored in this browser. Your Firefly server must allow this app’s origin through CORS.</p>
 <button disabled={busy} onclick={connect}>Connect & refresh accounts</button>
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
 <section class="queue"><p class="eyebrow">DEVICE ACTIVITY</p><div class="queue-heading"><h3>{pending.length ? `${pending.length} waiting to sync` : 'No pending purchases'}</h3><button disabled={busy||recording} onclick={synchronize}>{busy?'Working…':'Sync / retry'}</button></div>
 {#each pending as op}<article><strong>{op.name}</strong><span>{op.amount}</span><p>{op.legs.filter(l=>l.done).length} / {op.legs.length} entries synced</p>{#if op.error}<p class="error">{op.error}</p>{/if}</article>{/each}
 <p class="hint">Pending purchases stay on this device until synced. Keep browser data to retain them.</p></section>
 </div>
 <footer><span>firefly / assist</span><span>Purchases saved locally. Synced to your Firefly.</span></footer>
</main>
