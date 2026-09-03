<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { posterUrl, releaseYear } from '$lib/format/tmdb-image';
	import { getReleaseInfo } from '$lib/domain/release';
	import type { MediaType } from '$lib/types';

	/**
	 * The poster tile every grid is built from.
	 *
	 * It owns the artwork, the badges and the title; what can be *done* with the
	 * title is passed in as a snippet, because that is the only thing that differs
	 * between Discover ("save it") and My List ("track it, drop it").
	 */
	interface Props {
		title: string;
		posterPath: string | null;
		releaseDate: string | null;
		voteAverage: number | null;
		mediaType: MediaType;
		/** Visually mark the tile as already watched. */
		watched?: boolean;
		/** Extra line under the title, e.g. season progress. */
		note?: string;
		/**
		 * A TV season that has not aired, badged on the poster the same way an
		 * unreleased film is — the visual language for "not watchable yet" should
		 * not depend on whether the title is a film or a show.
		 */
		upcomingSeason?: { number: number; label: string } | null;
		/**
		 * Set on the tiles that land above the fold.
		 *
		 * `loading="lazy"` is right for a long grid but wrong for its first row:
		 * lazy images are invisible to the preload scanner and fetched at low
		 * priority, so applying it to every poster pushes the one that *is* the
		 * LCP element to the back of the queue.
		 *
		 * Measured against the production build on Discover: LCP 972ms -> ~885ms
		 * and FCP 640ms -> ~570ms. Local numbers, so the real-network gap is
		 * likely wider — priority hints matter most under bandwidth contention.
		 */
		priority?: boolean;
		/** When provided, the poster and title become clickable to open details. */
		onSelect?: () => void;
		/**
		 * Where the poster and title lead, when following the tile means going
		 * somewhere rather than opening a sheet over what is already here.
		 *
		 * A real anchor rather than a button that navigates, because a grid of
		 * links is a grid people open in background tabs — which is precisely what
		 * somebody does with a list they have been sent. Ignored when `onSelect` is
		 * given; a tile has one behaviour.
		 */
		href?: string;
		/** Action controls rendered in the card footer (buttons, forms, badges). */
		actions?: Snippet;
	}

	let {
		title,
		posterPath,
		releaseDate,
		voteAverage,
		mediaType,
		watched = false,
		note,
		upcomingSeason = null,
		priority = false,
		onSelect,
		href,
		actions
	}: Props = $props();

	/** Which of the two follow behaviours this tile has, if either. */
	const interactive = $derived(Boolean(onSelect || href));

	/**
	 * The title's own styling, shared by the button and the anchor forms of it.
	 *
	 * Named rather than repeated: the two differ only in which element they are,
	 * and a class list copied into both is one that will be edited in one.
	 */
	const TITLE_LINK =
		'-my-3 block cursor-pointer py-3 text-left text-sm leading-snug font-semibold text-ink transition-colors duration-200 hover:text-brand-hi';

	const poster = $derived(posterUrl(posterPath, 'w342'));
	const year = $derived(releaseYear(releaseDate));
	const rating = $derived(voteAverage ? voteAverage.toFixed(1) : null);

	// TMDB returns titles that are still in production alongside released ones,
	// so the card has to be able to say "not out yet — here's when".
	const release = $derived(getReleaseInfo(releaseDate));
	const unreleased = $derived(release.state !== 'released');
</script>

<!--
	`h-full` is what keeps a row of cards level.

	A card is as tall as its title needs, so a two-line title makes one tile 20px
	taller than its neighbours and drops its button below the line they share.
	Grid and flex containers stretch their *own* children, but every caller wraps
	this card in something — a scroll-snap tile, a `div` carrying the flip
	animation — so the stretch lands on the wrapper and stops there. Filling the
	wrapper passes it the rest of the way down.
-->
<article
	class="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-surface shadow-lg ring-1 shadow-black/20 transition duration-300 ease-[var(--ease-out-soft)] hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40
		{unreleased ? 'ring-amber/20 hover:ring-amber/40' : 'ring-line hover:ring-brand/40'}"
>
	<div class="relative aspect-[2/3] w-full overflow-hidden bg-surface-hi">
		{#if poster}
			<img
				src={poster}
				alt={`${title} poster`}
				loading={priority ? 'eager' : 'lazy'}
				fetchpriority={priority ? 'high' : 'auto'}
				decoding="async"
				class="h-full w-full object-cover transition duration-500 ease-[var(--ease-out-soft)] group-hover:scale-105"
				class:grayscale={watched}
				class:opacity-50={watched}
			/>
		{:else}
			<div class="flex h-full w-full flex-col items-center justify-center gap-1.5 text-ink-faint">
				<Icon name="image" size={28} stroke={1.5} />
				<span class="text-[11px]">No image</span>
			</div>
		{/if}

		<!-- Bottom fade so badges stay legible over any poster. -->
		<div
			class="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-canvas/95 via-canvas/40 to-transparent"
		></div>

		<!--
			The badges below are flat, unlike the frosted header and sheet.

			They used to carry `backdrop-blur-sm` for the same look, and at 65-70%
			black over a poster a 4px blur is invisible — screenshots of a badge with
			and without it are indistinguishable. What it was not was free: each one
			is a compositing layer the compositor re-samples every frame, and there
			are two per card. On a grid of 77 titles that is 154 of them, and
			removing them halved the renderer's work during a scroll (794ms -> 392ms
			over 300 frames, `Commit` 1.19ms -> 0.25ms per frame, 4x CPU throttle).

			The two places blur is still worth its cost — the sticky header and the
			sheet — are one element each and sit over genuinely moving content.
		-->

		<span
			class="absolute top-2 left-2 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-1 text-[10px] font-bold tracking-wider text-ink uppercase"
		>
			<Icon name={mediaType === 'tv' ? 'tv' : 'film'} size={11} stroke={2.4} />
			{mediaType === 'tv' ? 'TV' : 'Film'}
		</span>

		{#if rating}
			<span
				class="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-1 text-[11px] font-bold text-gold"
			>
				<Icon name="star" size={11} filled />
				{rating}
			</span>
		{/if}

		<!-- Release marker: a soft amber pulse reads as "pending" at a glance,
		     without competing with the poster art. The same badge covers a film
		     that is not out and a season that has not aired. -->
		{#if !unreleased && upcomingSeason}
			<span
				class="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/70 py-1 pr-2.5 pl-2 text-[10px] font-semibold tracking-wide text-amber ring-1 ring-amber/25 ring-inset"
			>
				<span class="sr-only">Next season not aired yet —</span>
				<span class="relative flex h-1.5 w-1.5">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-70"
					></span>
					<span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber"></span>
				</span>
				S{upcomingSeason.number}
				{upcomingSeason.label}
			</span>
		{/if}

		{#if unreleased}
			<span
				class="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/70 py-1 pr-2.5 pl-2 text-[10px] font-semibold tracking-wide text-amber ring-1 ring-amber/25 ring-inset"
			>
				<span class="sr-only">Not released yet —</span>
				<span class="relative flex h-1.5 w-1.5">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-70"
					></span>
					<span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber"></span>
				</span>
				{release.shortLabel}
			</span>
		{/if}

		{#if watched}
			<span class="pointer-events-none absolute inset-0 flex items-center justify-center">
				<span
					class="flex items-center gap-1.5 rounded-full bg-mint px-3 py-1.5 text-xs font-bold text-canvas shadow-lg"
				>
					<Icon name="check" size={13} stroke={3} /> Watched
				</span>
			</span>
		{/if}

		<!-- Transparent overlay opens the detail view (kept last so it sits
		     on top of the badges and the overlay). -->
		{#if onSelect}
			<button
				type="button"
				onclick={onSelect}
				aria-label={`View details for ${title}`}
				class="absolute inset-0 cursor-pointer"
			></button>
		{:else if href}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- `href` is an in-app path built by the caller's route helper; see the prop's doc -->
			<a {href} aria-label={`View details for ${title}`} class="absolute inset-0"></a>
		{/if}
	</div>

	<div class="flex flex-1 flex-col gap-1 p-3">
		{#if interactive}
			<!--
				`py-3 -my-3` grows the hit area to the 44px a thumb needs without
				moving the text a pixel. The poster above is the same action and a
				much larger target, so this is the secondary route — but a 19px-tall
				line was not a target at all.

				The clamp belongs to the span, not to the button, and the two reasons
				are separate. `-webkit-line-clamp` needs a `-webkit-box`, which a
				`<button>` refuses to become — it blockifies to `flow-root`, leaving
				the clamp inert. And `overflow: hidden` clips at the *padding* box, so
				with padding on the same element a third line still paints inside it —
				straight over the year underneath, which the negative margin has pulled
				up to meet it. A padding-free element clips where its text ends.
			-->
			{#if onSelect}
				<button type="button" onclick={onSelect} {title} class={TITLE_LINK}>
					<span class="line-clamp-2">{title}</span>
				</button>
			{:else}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- same in-app path as the poster overlay above -->
				<a {href} {title} class={TITLE_LINK}>
					<span class="line-clamp-2">{title}</span>
				</a>
			{/if}
		{:else}
			<h3 class="line-clamp-2 text-sm leading-snug font-semibold text-ink" {title}>{title}</h3>
		{/if}

		<!-- The poster badge carries the date; this line carries the meaning, so
		     an amber "Dec 16" can never be mistaken for an ordinary release year. -->
		{#if unreleased}
			<p class="text-xs font-medium text-amber">Not released yet</p>
		{:else if note}
			<p class="text-xs text-ink-muted">{note}</p>
		{:else if year}
			<p class="text-xs text-ink-faint">{year}</p>
		{/if}

		{#if actions}<div class="mt-auto pt-2">{@render actions()}</div>{/if}
	</div>
</article>
