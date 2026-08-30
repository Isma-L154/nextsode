<script lang="ts">
	import './layout.css';
	import type { Snippet } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import AppShell from '$lib/components/ui/AppShell.svelte';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<!--
	Icons at fixed paths, not bundled ones.

	The build fingerprints imported assets, which is right for cache-busting and
	wrong for an icon: Google's index, a phone's home screen and a bookmark all
	hold on to the URL they first saw, and a hashed filename changes it on every
	deploy. The SVG covers modern browsers, the PNG covers the crawlers and
	launchers that still do not accept one.
-->
<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</svelte:head>

<AppShell user={data.user} authAvailable={data.authAvailable} toWatchCount={data.toWatchCount}>
	{@render children()}
</AppShell>

<Toaster />
