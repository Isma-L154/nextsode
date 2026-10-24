<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import Icon, { type IconName } from './Icon.svelte';
	import { toasts, type ToastType } from '#lib/stores/toasts.svelte.js';

	const styles: Record<ToastType, string> = {
		success: 'bg-mint text-canvas',
		error: 'bg-rose text-canvas',
		info: 'bg-surface-hi text-ink ring-1 ring-line'
	};

	const toastIcons: Record<ToastType, IconName> = {
		success: 'check',
		error: 'alert',
		info: 'info'
	};
</script>

<!--
	Sits above the mobile tab bar rather than behind it: at `bottom-5` the toast
	appeared underneath the fixed navigation on a phone, which is exactly where
	nobody would see it.
-->
<div
	class="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6"
>
	{#each toasts.items as toast (toast.id)}
		<div
			role="status"
			in:fly={{ y: 20, duration: 250 }}
			out:fade={{ duration: 180 }}
			animate:flip={{ duration: 200 }}
			class="pointer-events-auto flex max-w-full items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold shadow-xl shadow-black/40 {styles[
				toast.type
			]}"
		>
			<Icon name={toastIcons[toast.type]} size={15} stroke={2.5} />
			<span class="truncate">{toast.message}</span>
		</div>
	{/each}
</div>
