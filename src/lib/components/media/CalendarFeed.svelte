<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { absorb } from '$lib/forms/feedback';
	import { subscribeLinks } from '$lib/domain/calendar';
	import type { SubmitFunction } from '@sveltejs/kit';

	/**
	 * Subscribing a calendar app to everything still to come.
	 *
	 * It sits in Upcoming, the one tab where the date is already the content, on
	 * the same reasoning as the auto-archive control: a setting met where it
	 * applies needs no explaining, and a settings screen for two of them would be
	 * more navigation than feature.
	 */
	interface Props {
		/** The current feed token, or null when there is no feed. */
		token: string | null;
		/** Absolute origin, so the URL shown is the one that will be pasted. */
		origin: string;
	}

	let { token, origin }: Props = $props();

	let field = $state<HTMLInputElement | null>(null);
	let confirmingReset = $state(false);

	const url = $derived(token ? `${origin}/calendar/${token}.ics` : null);
	const links = $derived(url ? subscribeLinks(url) : null);

	const feedback = (message: string): SubmitFunction => {
		return () =>
			async ({ result, update }) => {
				confirmingReset = false;
				if (await absorb(result, update)) toasts.add(message, 'info');
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
			toasts.add('Calendar link copied');
		} catch {
			field?.select();
			toasts.add('Press Ctrl/Cmd + C to copy the link', 'info');
		}
	}
</script>

<section
	class="mb-5 rounded-xl bg-surface/60 px-3.5 py-3 ring-1 ring-line"
	aria-labelledby="calendar-feed-heading"
>
	<div class="flex items-center gap-2">
		<Icon name="calendar" size={15} class="shrink-0 text-ink-faint" />
		<h3 id="calendar-feed-heading" class="text-sm font-semibold text-ink">In your calendar</h3>
	</div>

	{#if !url}
		<p class="mt-1.5 text-xs text-ink-muted">
			Subscribe your calendar to this list and every release and season premiere shows up on the day
			it lands. Works with Google Calendar, Apple Calendar and Outlook.
		</p>
		<form method="POST" action="?/issueCalendarFeed" use:enhance={feedback('Calendar link ready')}>
			<button
				type="submit"
				class="mt-2.5 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-surface-hi px-4 text-xs font-semibold text-ink ring-1 ring-line transition-colors duration-200 ring-inset hover:bg-line"
			>
				<Icon name="plus" size={14} stroke={2.5} /> Create a calendar link
			</button>
		</form>
	{:else}
		<p class="mt-1.5 text-xs text-ink-muted">
			Pick your calendar and confirm — nothing is added until you say so.
		</p>

		<!--
			Two links rather than an instruction.
			
			This used to read "in Google Calendar it is Other calendars → From URL",
			which is four steps and a menu most people have never opened. Neither
			link grants us anything: the calendar app fetches the feed itself, and
			asks the visitor before adding it.
		-->
		<div class="mt-2.5 flex flex-wrap gap-2">
			<!-- eslint-disable svelte/no-navigation-without-resolve -- resolve() maps this app's own routes; these hand the feed to a calendar app -->
			<a
				href={links?.google}
				target="_blank"
				rel="noopener noreferrer"
				class="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-4 text-xs font-semibold text-white transition-colors duration-200 hover:bg-brand-hi"
			>
				<Icon name="calendar" size={14} /> Google Calendar
			</a>
			<!--
				`webcal:` is what Apple Calendar and Outlook register as handlers for.
				A desktop with no calendar app installed does nothing with it, which is
				why it sits beside the Google link and not instead of it.
			-->
			<a
				href={links?.webcal}
				class="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-surface-hi px-4 text-xs font-semibold text-ink ring-1 ring-line transition-colors duration-200 ring-inset hover:bg-line"
			>
				<Icon name="calendar" size={14} /> Apple or Outlook
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</div>

		<p class="mt-3 text-[11px] text-ink-faint">Or add it by URL yourself:</p>

		<div class="mt-1.5 flex flex-wrap items-center gap-2">
			<!--
				Readonly rather than plain text: it is selectable, it survives a tap on
				mobile, and it is what makes the clipboard fallback work.
			-->
			<input
				bind:this={field}
				value={url}
				readonly
				aria-label="Your calendar link"
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

		<!--
			Said plainly, because it will otherwise be read as a bug in this app.
			Google decides when to re-read an external calendar and gives no way to
			ask; Apple Calendar lets the subscriber choose.
		-->
		<p class="mt-2 text-[11px] text-ink-faint">
			Anyone with this link can see what is on your list, so keep it to yourself. New titles can
			take several hours to appear — calendar apps re-read subscriptions on their own schedule.
		</p>

		<div class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
			{#if confirmingReset}
				<form
					method="POST"
					action="?/issueCalendarFeed"
					use:enhance={feedback('New calendar link created')}
					class="flex items-center gap-3"
				>
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
				action="?/revokeCalendarFeed"
				use:enhance={feedback('Calendar link turned off')}
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
