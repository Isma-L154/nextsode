<script lang="ts">
	import './layout.css';
	import type { Snippet } from 'svelte';
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

	The SVG is not imported for the same reason, and for a worse one: it is small
	enough that Vite inlines it as a `data:` URI, which is not a URL a crawler can
	fetch at all.
-->
<svelte:head>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</svelte:head>

<AppShell user={data.user} authAvailable={data.authAvailable} toWatchCount={data.toWatchCount}>
	{@render children()}
</AppShell>

<Toaster />
