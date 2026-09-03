<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { absorb } from '$lib/forms/feedback';
	import { scopeFromChoices, type ShareScope } from '$lib/domain/share';
	import type { SubmitFunction } from '@sveltejs/kit';

	/**
	 * Publishing this list as a page, and taking it back.
	 *
	 * Sits in My List beside the calendar feed, on the same reasoning: a setting
	 * met where it applies needs no explaining, and a settings screen for three
	 * of them would be more navigation than feature.
	 *
	 * The two checkboxes are the whole of the control, and they come *before* the
	 * button on purpose. Deciding what to publish after publishing it is the
	 * wrong order for a decision that cannot be fully undone — a link that was
	 * open for ten seconds may already have been read.
	 */
	interface Props {
		/** The current share token, or null when the list is not shared. */
		token: string | null;
		/** What that link shows; the default when there is no link yet. */
		scope: ShareScope;
		/** Absolute origin, so the URL shown is the one that will be pasted. */
		origin: string;
	}

	let { token, scope, origin }: Props = $props();

	let field = $state<HTMLInputElement | null>(null);
	let confirmingReset = $state(false);

	/**
	 * The boxes, seeded from the stored scope and thereafter owned by the form.
	 *
	 * `$state` rather than `$derived`, because these are edited. A derived value
	 * would snap back to the server's answer the moment anything else on the page
	 * invalidated it — and on My List that happens on every tick of a title, so
	 * a half-made choice would vanish under the person making it. The server
	 * stays the authority: it re-reads the checkboxes on submit, and this is only
	 * what they show in between.
	 *
	 * `untrack` says that reading the prop once here is the intent, not the
	 * oversight it otherwise looks like.
	 */
	let sharingToWatch = $state(untrack(() => scope === 'toWatch' || scope === 'both'));
	let sharingWatched = $state(untrack(() => scope === 'watched' || scope === 'both'));

	const url = $derived(token ? `${origin}/share/${token}` : null);

	/** Null when neither box is ticked, which is the one state that cannot be saved. */
	const chosen = $derived(scopeFromChoices(sharingToWatch, sharingWatched));

	/** True once the boxes say something other than what the link currently shows. */
	const scopeChanged = $derived(chosen !== null && chosen !== scope);

	/**
	 * The usual absorb, with the form reset turned off.
	 *
	 * `enhance` clears a form's fields after a successful submit, which is right
	 * for a form you fill in and send — a comment box, a search — and wrong for
	 * one whose fields *are* a stored setting. Left on, ticking "To watch" and
	 * pressing create emptied both boxes the moment the link appeared, so the
	 * panel showed "Pick at least one to share" about a link that was already
	 * live and already scoped. The checkboxes describe state; they are not input
	 * that has been consumed.
	 */
	const feedback = (message: string): SubmitFunction => {
		return () =>
			async ({ result, update }) => {
				confirmingReset = false;
				if (await absorb(result, () => update({ reset: false }))) toasts.add(message, 'info');
			};
	};

	/**
	 * Copy, or fall back to selecting the text.
	 *
	 * `navigator.clipboard` needs a secure context and a permission that can be
	 * refused. When it is not there, leaving the URL selected turns the failure
	 * into one keystroke rather than a dead button.
	 */
	async function copy() {
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
			toasts.add('Share link copied');
		} catch {
			field?.select();
			toasts.add('Press Ctrl/Cmd + C to copy the link', 'info');
		}
	}
</script>

<section
	class="mb-5 rounded-xl bg-surface/60 px-3.5 py-3 ring-1 ring-line"
	aria-labelledby="share-list-heading"
>
	<div class="flex items-center gap-2">
		<Icon name="share" size={15} class="shrink-0 text-ink-faint" />
		<h3 id="share-list-heading" class="text-sm font-semibold text-ink">Share your list</h3>
	</div>

	<p class="mt-1.5 text-xs text-ink-muted">
		{#if url}
			Anyone with this link can see the titles you picked below. They don't need an account.
		{:else}
			Send friends a page showing what you picked. No account needed to open it, and you can turn it
			off at any time.
		{/if}
	</p>

	<!--
		One form around both checkboxes and the button, so what is ticked is what
		is submitted. `formaction` is what lets the same fields drive two actions:
		creating a link and re-scoping the one that exists are the same decision
		expressed at different moments.
	-->
	<form
		method="POST"
		action={url ? '?/updateShareScope' : '?/issueShareLink'}
		use:enhance={feedback(url ? 'Share link updated' : 'Share link ready')}
	>
		<fieldset class="mt-2.5">
			<legend class="sr-only">What to share</legend>
			<div class="flex flex-wrap gap-x-5 gap-y-2">
				<label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink">
					<input
						type="checkbox"
						name="toWatch"
						bind:checked={sharingToWatch}
						class="h-4 w-4 cursor-pointer accent-brand"
					/>
					To watch
				</label>
				<label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink">
					<input
						type="checkbox"
						name="watched"
						bind:checked={sharingWatched}
						class="h-4 w-4 cursor-pointer accent-brand"
					/>
					Watched
				</label>
			</div>
		</fieldset>

		{#if !chosen}
			<!--
				Said rather than silently disabling the button: a control that does
				nothing and does not say why is the same as a broken one.
			-->
			<p class="mt-2 text-[11px] text-amber">Pick at least one to share.</p>
		{/if}

		{#if !url}
			<button
				type="submit"
				disabled={!chosen}
				class="mt-2.5 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-surface-hi px-4 text-xs font-semibold text-ink ring-1 ring-line transition-colors duration-200 ring-inset hover:bg-line disabled:cursor-not-allowed disabled:opacity-50"
			>
				<Icon name="plus" size={14} stroke={2.5} /> Create a share link
			</button>
		{:else if scopeChanged}
			<button
				type="submit"
				class="mt-2.5 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-4 text-xs font-semibold text-white transition-colors duration-200 hover:bg-brand-hi"
			>
				<Icon name="check" size={14} stroke={2.5} /> Save what's shared
			</button>
		{/if}
	</form>

	{#if url}
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<!--
				Readonly rather than plain text: it is selectable, it survives a tap on
				mobile, and it is what makes the clipboard fallback work.
			-->
			<input
				bind:this={field}
				value={url}
				readonly
				aria-label="Your share link"
				onfocus={(event) => event.currentTarget.select()}
				class="min-w-0 flex-1 rounded-lg bg-surface-hi px-2.5 py-2 font-mono text-[11px] text-ink-muted ring-1 ring-line"
			/>
			<button
				type="button"
				onclick={copy}
				class="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl bg-surface-hi px-3.5 text-xs font-semibold text-ink-muted ring-1 ring-line transition-colors duration-200 ring-inset hover:bg-line hover:text-ink"
			>
				<Icon name="copy" size={14} /> Copy
			</button>
		</div>

		<p class="mt-2 text-[11px] text-ink-faint">
			The page shows your first name and the titles you picked — nothing else about your account.
			Anyone who has the link can pass it on, so treat it as public.
		</p>

		<div class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
			{#if confirmingReset}
				<form
					method="POST"
					action="?/issueShareLink"
					use:enhance={feedback('New share link created')}
					class="flex items-center gap-3"
				>
					<!--
						The scope travels with the reset too, so a rolled-over link keeps
						showing what the boxes above say. Without these the new link would
						silently fall back to the default.
					-->
					{#if sharingToWatch}<input type="hidden" name="toWatch" value="on" />{/if}
					{#if sharingWatched}<input type="hidden" name="watched" value="on" />{/if}
					<span class="text-[11px] text-amber">This stops the old link working.</span>
					<button
						type="submit"
						class="cursor-pointer text-[11px] font-semibold text-amber underline underline-offset-2"
					>
						Replace it
					</button>
					<button
						type="button"
						onclick={() => (confirmingReset = false)}
						class="cursor-pointer text-[11px] text-ink-faint underline underline-offset-2"
					>
						Cancel
					</button>
				</form>
			{:else}
				<button
					type="button"
					onclick={() => (confirmingReset = true)}
					class="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-faint transition-colors duration-200 hover:text-ink"
				>
					<Icon name="rotate" size={12} /> Get a new link
				</button>
			{/if}

			<form
				method="POST"
				action="?/revokeShareLink"
				use:enhance={feedback('Share link turned off')}
			>
				<button
					type="submit"
					class="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-faint transition-colors duration-200 hover:text-rose"
				>
					<Icon name="trash" size={12} /> Turn off
				</button>
			</form>
		</div>
	{/if}
</section>
