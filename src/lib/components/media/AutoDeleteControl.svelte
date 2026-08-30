<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { DELETION_WINDOWS, type DeletionWindow } from '$lib/domain/deletion';

	/**
	 * Chooses how long watched titles stay before they are deleted.
	 *
	 * Lives inside the Watched tab rather than in a settings screen: this is the
	 * one place the setting has any visible consequence, and a preference you meet
	 * where it applies needs no explaining.
	 *
	 * Defaults to off, and says plainly that this removes titles for good — an
	 * automatic rule with no undo has to be legible before it is convenient.
	 */
	interface Props {
		current: DeletionWindow | null;
	}

	let { current }: Props = $props();

	let form = $state<HTMLFormElement | null>(null);

	const onSubmit: SubmitFunction = () => {
		return async ({ result, update }) => {
			await update();
			if (result.type !== 'success') {
				if (result.type !== 'redirect') toasts.add('Something went wrong', 'error');
				return;
			}
			const days = (result.data as { autoDeleteDays?: number | null } | undefined)?.autoDeleteDays;
			toasts.add(
				days ? `Watched titles will be deleted after ${days} days` : 'Auto-delete turned off',
				'info'
			);
		};
	};
</script>

<div
	class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-surface/60 px-3.5 py-2.5 ring-1 ring-line"
>
	<Icon name="clock" size={15} class="text-ink-faint" />

	<form
		bind:this={form}
		method="POST"
		action="?/setAutoDelete"
		use:enhance={onSubmit}
		class="flex items-center gap-2"
	>
		<label class="flex items-center gap-2 text-xs text-ink-muted sm:text-sm">
			Delete watched titles after
			<select
				name="days"
				value={current ?? ''}
				onchange={() => form?.requestSubmit()}
				class="cursor-pointer appearance-none rounded-lg bg-surface-hi py-1.5 pr-7 pl-2.5 text-xs font-semibold text-ink ring-1 ring-line transition-colors duration-200 hover:bg-line sm:text-sm"
			>
				<option value="">never</option>
				{#each DELETION_WINDOWS as days (days)}
					<option value={days}>{days} days</option>
				{/each}
			</select>
		</label>
		<!-- Works without JavaScript; the select just submits it automatically. -->
		<noscript><button type="submit" class="text-xs underline">Save</button></noscript>
	</form>

	<p class="w-full text-[11px] text-ink-faint sm:w-auto sm:flex-1">
		Deleted for good, not archived. The countdown starts when you pick a window, and each card warns
		you for its last week with a one-tap
		<span class="font-semibold text-ink-muted">Keep</span>. Anything with a new season coming is
		never touched.
	</p>
</div>
