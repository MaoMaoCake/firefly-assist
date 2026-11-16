<script lang="ts">
 import { onMount } from 'svelte';
 type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{outcome: 'accepted' | 'dismissed'}> };
 let deferred: InstallEvent | null = null;
 let installed = false, ios = false, secure = true, installing = false, status = '';
 onMount(()=>{
  const display = window.matchMedia('(display-mode: standalone)');
  const update = () => { installed = display.matches || Boolean((navigator as Navigator & {standalone?: boolean}).standalone); };
  update(); secure = window.isSecureContext;
  ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const available = (event: Event) => { event.preventDefault(); deferred = event as InstallEvent; };
  const complete = () => { installed = true; deferred = null; status = ''; };
  window.addEventListener('beforeinstallprompt', available);
  window.addEventListener('appinstalled', complete);
  display.addEventListener('change', update);
  return () => {window.removeEventListener('beforeinstallprompt',available);window.removeEventListener('appinstalled',complete);display.removeEventListener('change',update);};
 });
 async function install() {
  const event=deferred;if(!event)return;
  installing=true;status='';
  try {await event.prompt();const choice=await event.userChoice;status=choice.outcome==='accepted'?'Installation requested. Look for Firefly Assist in your apps.':'You can install later using your browser’s menu.';}
  catch {status='Use your browser’s menu to install this app.';}
  finally {deferred=null;installing=false;}
 }
</script>
<section class="install-app" aria-label="Install Firefly Assist">
 <h3>{installed?'App installed':'Install Firefly Assist'}</h3>
 {#if installed}<p class="hint">You’re using the installed app.</p>
 {:else if !secure}<p class="hint">Open this app over HTTPS to install it. A phone’s local-network HTTP address does not support installation.</p>
 {:else if deferred}<p class="hint">Keep Firefly Assist on your home screen and record purchases offline.</p><button onclick={install} disabled={installing}>{installing?'Installing…':'Install app'}</button>
 {:else if ios}<p class="hint">In Safari, open Share → Add to Home Screen → Add. Enable “Open as Web App” if shown.</p>
 {:else}<p class="hint">In Chrome or Edge, use the address-bar install icon or the browser menu’s “Install app” option. On Mac Safari, choose File → Add to Dock.</p>{/if}
 {#if status}<p class="hint" role="status">{status}</p>{/if}
</section>
