import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({ plugins: [svelte(), VitePWA({ registerType: 'autoUpdate', manifest: { id: '/', scope: '/', description: 'Record purchases offline and track credit card savings transfers with Firefly III.', name: 'Firefly Assist', short_name: 'Firefly', theme_color: '#faf9ff', background_color: '#faf9ff', display: 'standalone', start_url: '/', icons: [192,512].map(size => ({ src: `/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })) }, workbox: { globPatterns: ['**/*.{js,css,html,svg,png}'] } })] });
