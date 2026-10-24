<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import type { SessionUser } from '#lib/types.js';

	interface Props {
		user: SessionUser;
	}

	let { user }: Props = $props();

	/** Fallback avatar when Google has no picture (or it fails to load). */
	const initial = $derived(user.name.trim().charAt(0).toUpperCase() || '?');
	let avatarFailed = $state(false);
</script>

<div class="flex items-center gap-1.5">
	<div
		class="flex items-center gap-2 rounded-full bg-surface p-1 ring-1 ring-line sm:pr-3"
		title={user.email}
	>
		{#if user.avatarUrl && !avatarFailed}
			<img
				src={user.avatarUrl}
				alt=""
				width="28"
				height="28"
				class="h-7 w-7 rounded-full object-cover"
				referrerpolicy="no-referrer"
				onerror={() => (avatarFailed = true)}
			/>
		{:else}
			<span
				class="flex h-7 w-7 items-center justify-center rounded-full bg-brand/20 text-xs font-bold text-brand-hi"
			>
				{initial}
			</span>
		{/if}
		<span class="hidden max-w-[9rem] truncate text-sm font-medium text-ink sm:block">
			{user.name}
		</span>
	</div>

	<!-- Plain POST form: no JavaScript required, and CSRF-protected by SvelteKit. -->
	<form method="POST" action="/auth/logout">
		<button
			type="submit"
			aria-label="Sign out"
			title="Sign out"
			class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ink-faint transition-colors duration-200 hover:bg-surface-hi hover:text-ink"
		>
			<Icon name="logout" size={16} />
		</button>
	</form>
</div>
