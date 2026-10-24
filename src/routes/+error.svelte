<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';

	const notFound = $derived(page.status === 404);
	const title = $derived(notFound ? 'Page not found' : 'Something went wrong');
</script>

<!--
	No canonical or share card: an error has no URL of its own worth ranking or
	previewing. The 404 copy is deliberately vague about *why* — an unissued share
	token and a revoked one must read the same, or the page confirms the link was
	once real.
-->
<svelte:head>
	<title>{title} — Nextsode</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<section class="flex min-h-[60dvh] flex-col items-center justify-center py-12 text-center">
	<span
		class="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-hi text-ink-faint ring-1 ring-line"
	>
		<Icon name={notFound ? 'film' : 'alert'} size={26} stroke={1.75} />
	</span>
	<p class="mt-5 text-xs font-semibold tracking-wider text-ink-faint uppercase">
		Error {page.status}
	</p>
	<h1 class="mt-1 font-display text-2xl font-extrabold text-ink sm:text-3xl">{title}</h1>
	<p class="mt-2 max-w-sm text-sm text-balance text-ink-muted">
		{notFound
			? 'The link may be mistyped, or what it pointed to is not here.'
			: 'That one is on us, not you. Please try again in a moment.'}
	</p>

	<div class="mt-7 flex flex-wrap justify-center gap-3">
		<a
			href={resolve('/')}
			class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-sm shadow-brand/30 transition-colors duration-200 hover:bg-brand-hi"
		>
			<Icon name="compass" size={16} />
			Browse Discover
		</a>
		<a
			href={resolve('watchlist')}
			class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-surface-hi px-5 text-sm font-semibold text-ink-muted ring-1 ring-line transition-colors duration-200 ring-inset hover:bg-line hover:text-ink"
		>
			<Icon name="bookmark" size={16} />
			My List
		</a>
	</div>
</section>
