<script lang="ts">
	import { tick } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { copyToClipboard } from '$lib/forms/feedback';

	/**
	 * Hand this title's public link to somebody.
	 *
	 * Three ways of doing that, tried in order, because no single one works
	 * everywhere. The share sheet is what people mean by "share" on a phone and
	 * it reaches apps a web page cannot; the clipboard is what a desktop has
	 * instead; and revealing the URL covers the case where both are refused —
	 * `navigator.clipboard` needs a secure context and a permission that can be
	 * denied. The same ladder as `CalendarFeed`, one rung taller.
	 *
	 * The link itself is public and carries nothing about who shared it, so there
	 * is no confirmation step here: this button copies a URL, it does not publish
	 * anything.
	 */
	interface Props {
		/** Absolute URL to the title's public page. */
		url: string;
		/** The title's name, which the OS share sheet shows as the subject. */
		title: string;
		/** Full width under the save control, or compact beside it. */
		variant?: 'full' | 'compact';
	}

	let { url, title, variant = 'full' }: Props = $props();

	/** The URL, shown only once both quieter ways of handing it over have failed. */
	let field = $state<HTMLInputElement | null>(null);
	let revealed = $state(false);

	async function share() {
		if (navigator.share) {
			try {
				await navigator.share({ title, url });
				return;
			} catch (error) {
				// Dismissing the sheet is a decision, not a failure. Falling through
				// to the clipboard here would copy a link the person just declined to
				// send, and pop a toast saying so.
				if (error instanceof DOMException && error.name === 'AbortError') return;
			}
		}

		// Unlike the panels, this button has no field on screen until the clipboard
		// has actually refused — so revealing one is part of the fallback, and the
		// tick is what gives it time to exist before it is selected.
		await copyToClipboard(url, {
			success: 'Link copied',
			onRefused: async () => {
				revealed = true;
				await tick();
				field?.select();
			}
		});
	}
</script>

<button
	type="button"
	onclick={share}
	aria-label={`Share ${title}`}
	class={[
		'flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-surface-hi text-sm font-semibold text-ink-muted ring-1 ring-line transition-colors duration-200 ring-inset hover:bg-line hover:text-ink',
		variant === 'full' ? 'mt-3 w-full py-3' : 'px-4'
	]}
>
	<Icon name="share" size={16} /> Share
</button>

{#if revealed}
	<input
		bind:this={field}
		value={url}
		readonly
		aria-label={`Link to ${title}`}
		onfocus={(event) => event.currentTarget.select()}
		class="mt-2 w-full rounded-lg bg-surface-hi px-2.5 py-2 font-mono text-[11px] text-ink-muted ring-1 ring-line"
	/>
{/if}
