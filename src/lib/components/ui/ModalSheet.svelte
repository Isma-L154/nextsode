<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import Icon from './Icon.svelte';
	import { lockScroll } from '$lib/stores/scroll-lock';

	/**
	 * A modal sheet: bottom-anchored on a phone, centred on a pointer device.
	 *
	 * Everything here is the part that is easy to get subtly wrong and invisible
	 * when it is — background scroll, where focus goes on open and on close, and
	 * whether Tab can walk out of the dialog into the page behind it. Holding it
	 * in one component means the next sheet inherits the fixes rather than
	 * repeating the bugs.
	 */
	interface Props {
		/** Labels the dialog for assistive tech. */
		label: string;
		onClose: () => void;
		children: Snippet;
	}

	let { label, onClose, children }: Props = $props();

	let dialog = $state<HTMLElement | null>(null);

	/**
	 * Drag-to-dismiss.
	 *
	 * The sheet has always drawn a grab handle on phones — the affordance people
	 * expect from a bottom sheet — and never answered it. A handle that says
	 * "pull me" and does nothing is worse than no handle at all, so this is the
	 * behaviour catching up with the promise.
	 */

	/** How far the sheet has been pulled down, in pixels. Zero when at rest. */
	let dragOffset = $state(0);
	/** Set while a finger is down and the gesture belongs to the sheet, not the scroller. */
	let dragging = $state(false);
	let dragStartY = 0;

	/** Past this, letting go dismisses. Below it, the sheet springs back. */
	const DISMISS_AFTER = 120;

	/**
	 * Only touch, and only from the top of the scroll.
	 *
	 * A mouse has the close button and the backdrop, so capturing its drags would
	 * only break text selection. And a sheet whose content is scrolled down must
	 * keep scrolling: starting a dismiss there would mean a flick to read more
	 * closes the thing being read.
	 */
	function onPointerDown(event: PointerEvent) {
		if (event.pointerType === 'mouse') return;
		if (!dialog || dialog.scrollTop > 0) return;

		dragging = true;
		dragStartY = event.clientY;
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging) return;

		const delta = event.clientY - dragStartY;
		if (delta <= 0) {
			// Pulling up is the scroller's gesture, not ours.
			dragOffset = 0;
			return;
		}

		// Resistance past the threshold, so the sheet feels attached to something
		// rather than tracking the finger forever.
		dragOffset = delta > DISMISS_AFTER ? DISMISS_AFTER + (delta - DISMISS_AFTER) * 0.35 : delta;
	}

	function onPointerUp() {
		if (!dragging) return;

		const dismiss = dragOffset >= DISMISS_AFTER;
		dragging = false;
		dragOffset = 0;
		if (dismiss) onClose();
	}

	/**
	 * Open/close side effects: lock the background scroll and hand focus back to
	 * whatever opened the sheet.
	 *
	 * Deliberately reads nothing reactive — `dialog` is untracked — so it runs
	 * exactly once per mount. Folding this together with the key handler below
	 * would tie it to `onClose`, which callers pass as an inline arrow and so gets
	 * a fresh identity on every re-render; a single form action would then tear
	 * the effect down mid-session, bounce focus, and re-capture
	 * `previouslyFocused` as the dialog itself — leaving the final close to
	 * restore focus to a node that no longer exists.
	 */
	$effect(() => {
		// Shared rather than per-sheet: two sheets can be mounted at once while one
		// replaces the other, and each answering "what was the overflow before me?"
		// gets a different, wrong answer. See `$lib/stores/scroll-lock`.
		const releaseScroll = lockScroll();
		const previouslyFocused = document.activeElement as HTMLElement | null;

		untrack(() => dialog)?.focus();

		return () => {
			releaseScroll();
			previouslyFocused?.focus();
		};
	});

	/**
	 * Escape to close, and a focus trap for Tab.
	 *
	 * Without the trap, tabbing walks straight out of the dialog and into the page
	 * behind it — which is still there, still interactive, and now invisible to a
	 * screen-reader user who has no way of knowing they left.
	 */
	$effect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onClose();
				return;
			}
			if (event.key !== 'Tab' || !dialog) return;

			// Queried per keypress rather than cached: a sheet's focusable set changes
			// as it loads and as its controls swap.
			const focusable = [
				...dialog.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])'
				)
			].filter((element) => element.offsetParent !== null || element === document.activeElement);
			if (focusable.length === 0) return;

			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};

		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="fixed inset-0 z-40 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
	transition:fade={{ duration: 150 }}
	onclick={onClose}
	role="presentation"
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		bind:this={dialog}
		class="relative max-h-[92dvh] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-t-3xl bg-surface shadow-2xl ring-1 ring-line sm:rounded-3xl"
		style:transform={dragOffset ? `translateY(${dragOffset}px)` : undefined}
		style:transition={dragging ? 'none' : 'transform 220ms var(--ease-out-soft, ease-out)'}
		transition:fly={{ y: 40, duration: 220, opacity: 1 }}
		onclick={(event) => event.stopPropagation()}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		role="dialog"
		aria-modal="true"
		aria-label={label}
		tabindex="-1"
	>
		<!--
			Grab handle: the bottom-sheet affordance people expect on a phone, and
			since the drag above, one the sheet actually answers. Left
			`pointer-events-none` on purpose — the whole sheet is the drag surface,
			so the handle only has to say so.
		-->
		<div class="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center sm:hidden">
			<span
				class="h-1 w-10 rounded-full transition-colors duration-150 {dragging
					? 'bg-white/60'
					: 'bg-white/25'}"
			></span>
		</div>

		<button
			type="button"
			onclick={onClose}
			aria-label="Close"
			class="absolute top-3 right-3 z-10 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/55 text-ink backdrop-blur transition-colors duration-200 hover:bg-black/75"
		>
			<Icon name="close" size={18} />
		</button>

		{@render children()}
	</div>
</div>
