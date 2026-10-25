<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';
	import type { MediaSearch } from '#lib/stores/search.svelte.js';

	interface Props {
		search: MediaSearch;
		placeholder?: string;
	}

	let { search, placeholder = 'Search movies and TV shows…' }: Props = $props();

	let input = $state<HTMLInputElement | null>(null);

	/**
	 * Search for whatever the box already held when the page came alive.
	 *
	 * The box is real HTML from the server, so it is focusable and typeable the
	 * moment it paints — which on a slow connection is seconds before the script
	 * that makes it *search* has arrived. Svelte's binding does adopt the text
	 * that was typed, but nothing ever fired `oninput`, so no request was
	 * scheduled for it: the page switches to the results view and reports "no
	 * results" for a search it never ran. A wrong answer, rather than a slow one.
	 *
	 * `onMount` and not setup, because a write during hydration lands in the
	 * state without re-rendering markup already reconciled against the server's
	 * HTML.
	 */
	onMount(() => {
		if (search.query) search.onInput();
	});

	/** Somewhere a slash is a character rather than a command. */
	function isTyping(element: Element | null): boolean {
		if (!(element instanceof HTMLElement)) return false;
		if (element.isContentEditable) return true;
		return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
	}

	/**
	 * `/` and ⌘K focus the search box from anywhere on the page.
	 *
	 * Search is the primary action here and reaching it otherwise costs a scroll
	 * back to the top. Two guards keep the shortcut from being a nuisance: it
	 * never fires while something editable has focus — a slash typed into a field
	 * is a slash — and it stays out of the way while a sheet is open, where the
	 * dialog owns the keyboard and its own focus trap.
	 */
	$effect(() => {
		const onKey = (event: KeyboardEvent) => {
			const wantsSearch =
				event.key === '/' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k');
			if (!wantsSearch) return;
			if (isTyping(document.activeElement)) return;
			if (document.querySelector('[role="dialog"]')) return;

			event.preventDefault();
			input?.focus();
			// Selected, so typing replaces the old query instead of appending to it.
			input?.select();
		};

		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

<label class="relative block">
	<span class="sr-only">Search movies and TV shows</span>

	<span
		class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-faint"
		aria-hidden="true"
	>
		{#if search.loading}
			<span
				class="block h-[18px] w-[18px] animate-spin rounded-full border-2 border-line border-t-brand-hi"
			></span>
		{:else}
			<Icon name="search" size={18} />
		{/if}
	</span>

	<!--
		16px on mobile is not a style choice: below it, iOS Safari zooms the whole
		page on focus and never zooms back out.
	-->
	<input
		bind:this={input}
		type="search"
		bind:value={search.query}
		oninput={search.onInput}
		{placeholder}
		autocomplete="off"
		enterkeyhint="search"
		maxlength="120"
		class="w-full rounded-2xl border border-line bg-surface py-3.5 pr-12 pl-11 text-base text-ink shadow-inner shadow-black/20 transition-colors duration-200 placeholder:text-ink-faint focus:border-brand focus:bg-surface-hi"
	/>

	<!--
		A shortcut nobody knows about helps nobody. The hint sits where the clear
		button will go, and yields to it the moment there is something to clear.

		Shown by a media query rather than by `matchMedia` in an effect: the check
		is about the input device, which never changes mid-session, and doing it in
		JavaScript means the hint is absent from the server's HTML and pops in after
		hydration. `(pointer: fine)` is the honest test — not a width, since a
		tablet is wide and still has no key to press.
	-->
	{#if !search.active}
		<span
			aria-hidden="true"
			class="pointer-events-none absolute top-1/2 right-3.5 hidden -translate-y-1/2 rounded-md bg-surface-hi px-2 py-1 font-mono text-[11px] leading-none text-ink-faint ring-1 ring-line [@media(hover:hover)_and_(pointer:fine)]:block"
		>
			/
		</span>
	{/if}

	{#if search.active}
		<button
			type="button"
			onclick={search.clear}
			aria-label="Clear search"
			class="absolute top-1/2 right-1.5 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-ink-faint transition-colors duration-200 hover:bg-surface-hi hover:text-ink"
		>
			<Icon name="close" size={16} />
		</button>
	{/if}
</label>

<!-- Announces result counts to screen readers without stealing focus. -->
<p class="sr-only" role="status" aria-live="polite">
	{#if search.loading}
		Searching…
	{:else if search.active}
		{search.results.length} results for {search.query}
	{/if}
</p>
