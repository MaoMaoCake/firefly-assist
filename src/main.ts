import { mount } from 'svelte';
import './theme';
import App from './App.svelte';
import './style.css';
mount(App, { target: document.getElementById('app')! });
