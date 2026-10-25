<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	/**
	 * A horizontal row of cards that can actually be moved through.
	 *
	 * The scrollbar is hidden, because a permanent grey bar under every row is
	 * noise — but hiding it removes the only affordance a mouse has. A trackpad
	 * swipes sideways and a phone drags, so the gap is invisible on the machines
	 * this tends to get built on and total on a desktop with a wheel mouse: the
	 * cards to the right simply cannot be reached.
	 *
	 * So the arrows are not decoration, they are the control. They appear only in
	 * the direction there is something to reach, which also makes them the
	 * indicator of how far along the row you are.
	 *
	 * Shared by every rail rather than written per row: the affordance, the edge
	 * fade and the snap padding all have to agree, and three of those were already
	 * wrong in one copy and right in another.
	 */
	interface Props {
		/** Names the row for assistive tech, e.g. "Because you watched Silo". */
		label: string;
		children: Snippet;
	}

	let { label, children }: Props = $props();

	let scroller = $state<HTMLDivElement | null>(null);
	let atStart = $state(true);
	let atEnd = $state(true);

	/**
	 * A pixel of slack at each end.
	 *
	 * Fractional scroll offsets are routine — device pixel ratios, sub-pixel
	 * layout — and an exact comparison leaves an arrow enabled at a limit it
	 * cannot move away from.
	 */
	const EDGE_SLACK = 1;

	function measure() {
		const el = scroller;
		if (!el) return;
		const furthest = el.scrollWidth - el.clientWidth;
		atStart = el.scrollLeft <= EDGE_SLACK;
		// Also true when nothing overflows, which is what hides both arrows.
		atEnd = el.scrollLeft >= furthest - EDGE_SLACK;
	}

	/**
	 * Re-measure on resize as well as on scroll: a row that overflows on a phone
	 * may not on a rotated tablet, and the arrows have to disappear with it.
	 */
	$effect(() => {
		const el = scroller;
		if (!el) return;

		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		for (const child of el.children) observer.observe(child);
		return () => observer.disconnect();
	});

	let backButton = $state<HTMLButtonElement | null>(null);
	let nextButton = $state<HTMLButtonElement | null>(null);

	/** Set when the arrow just pressed is about to unmount under the keyboard. */
	let handFocusTo = $state<'back' | 'next' | null>(null);

	function page(direction: 1 | -1) {
		const el = scroller;
		if (!el) return;

		// Just under a full width, so the card at the edge stays on screen as the
		// anchor for where you were — a whole-width jump loses the thread.
		const distance = el.clientWidth * 0.8 * direction;
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		/**
		 * Pressing the last arrow retires it, and a keyboard user holding focus on
		 * a button that unmounts is returned to the top of the document — several
		 * tab stops from where they were working.
		 *
		 * The opposite arrow cannot simply be focused here: it does not exist yet.
		 * Reaching a limit is what *creates* it, so the intent is recorded and an
		 * effect hands focus over once it appears. Only for a keyboard press —
		 * `:focus-visible` is the browser's own answer to "was this a real
		 * keyboard interaction", and moving focus after a mouse click would put a
		 * focus ring somewhere nobody asked for one.
		 */
		const pressed = direction === 1 ? nextButton : backButton;
		const furthest = el.scrollWidth - el.clientWidth;
		const target = el.scrollLeft + distance;
		const reachesLimit = direction === 1 ? target >= furthest - EDGE_SLACK : target <= EDGE_SLACK;

		if (reachesLimit && pressed?.matches(':focus-visible')) {
			handFocusTo = direction === 1 ? 'back' : 'next';
		}

		el.scrollBy({ left: distance, behavior: reduced ? 'auto' : 'smooth' });
	}

	$effect(() => {
		if (!handFocusTo) return;
		const target = handFocusTo === 'back' ? backButton : nextButton;
		if (!target) return;

		target.focus();
		// Untracked so clearing the flag cannot re-enter this effect.
		untrack(() => (handFocusTo = null));
	});

	/**
	 * The edge fade follows the arrows: a row fades on the side it continues on,
	 * and a row with nothing left to show has a hard edge again. A permanent fade
	 * would dim the last card for no reason.
	 */
	const mask = $derived.by(() => {
		const start = atStart ? '' : 'transparent, black 3rem';
		const end = atEnd ? '' : 'black calc(100% - 3rem), transparent';
		// No value rather than `none`: the server render then carries no style
		// attribute for the CSP to block.
		if (!start && !end) return undefined;
		return `linear-gradient(to right, ${[start, end].filter(Boolean).join(', ')})`;
	});
</script>

<div class="relative">
	<div
		bind:this={scroller}
		onscroll={measure}
		style:mask-image={mask}
		class="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-pl-4 items-stretch gap-3 overflow-x-auto px-4 pt-2 pb-3 sm:-mx-6 sm:scroll-pl-6 sm:px-6"
	>
		{@render children()}
	</div>

	<!--
		Hidden below `sm`, where dragging the row is the natural gesture and a
		button parked on top of a card would only be in the way of it.

		Sized and contrasted to be *found*, not to be tasteful: the row it replaces
		shipped with the scrollbar hidden and no affordance at all, so an arrow
		nobody notices fails in exactly the same way.
	-->
	{#if !atStart}
		<button
			bind:this={backButton}
			type="button"
			onclick={() => page(-1)}
			aria-label={`Back in ${label}`}
			class="absolute top-[38%] left-0 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-canvas/95 text-ink shadow-xl ring-1 shadow-black/60 ring-white/15 backdrop-blur transition-colors duration-200 hover:bg-surface-hi sm:flex"
		>
			<Icon name="chevronLeft" size={20} stroke={2.5} />
		</button>
	{/if}

	{#if !atEnd}
		<button
			bind:this={nextButton}
			type="button"
			onclick={() => page(1)}
			aria-label={`More in ${label}`}
			class="absolute top-[38%] right-0 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-canvas/95 text-ink shadow-xl ring-1 shadow-black/60 ring-white/15 backdrop-blur transition-colors duration-200 hover:bg-surface-hi sm:flex"
		>
			<Icon name="chevronRight" size={20} stroke={2.5} />
		</button>
	{/if}
</div>
