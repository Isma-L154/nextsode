<script lang="ts" module>
	/**
	 * The app's single icon set.
	 *
	 * Emoji were the previous stand-in for icons, and they are a poor one: they
	 * render as a different picture on every platform, ignore `currentColor`, and
	 * carry a font-dependent baseline that no amount of CSS can align reliably.
	 * These are Lucide paths (ISC licensed), inlined so the whole set costs zero
	 * network requests and inherits colour and size from its container.
	 *
	 * All paths are authored on a 24x24 grid with a 2px stroke, which is what makes
	 * mixing them at any size look deliberate rather than accidental.
	 */
	export const icons = {
		search: 'M21 21l-4.34-4.34M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',
		close: 'M18 6 6 18M6 6l12 12',
		check: 'M20 6 9 17l-5-5',
		plus: 'M5 12h14M12 5v14',
		minus: 'M5 12h14',
		trash:
			'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M10 11v6M14 11v6',
		play: 'M6 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 6 4.5Z',
		star: 'M12 2.5l2.9 5.88 6.5.95-4.7 4.58 1.11 6.47L12 17.33l-5.81 3.05 1.11-6.47-4.7-4.58 6.5-.95L12 2.5Z',
		compass:
			'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12Z',
		bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z',
		flame:
			'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z',
		clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
		calendar:
			'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
		film: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4',
		tv: 'M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2ZM17 2l-5 5-5-5',
		layers: 'M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
		user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
		logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
		lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM7 11V7a5 5 0 0 1 10 0v4',
		rotate: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
		filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3Z',
		info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01',
		alert: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 8v4M12 16h.01',
		image:
			'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM21 15l-5-5L5 21',
		chevronRight: 'M9 18l6-6-6-6',
		chevronLeft: 'M15 18l-6-6 6-6',
		sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z',
		copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1ZM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
		// The arrow-out-of-a-box mark, not the three-connected-dots one: iOS uses
		// this for Share and Android is the only place the dots read as sharing.
		share: 'M12 15V3M8 7l4-4 4 4M20 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5'
	} as const;

	export type IconName = keyof typeof icons;
</script>

<script lang="ts">
	interface Props {
		name: IconName;
		/** Rendered size in px. Defaults to 20, the app's inline-with-text size. */
		size?: number;
		/** Stroke width; scale it down for large icons so they stay optically even. */
		stroke?: number;
		/** Fill the shape with `currentColor` instead of stroking it (star, play). */
		filled?: boolean;
		class?: string;
		/**
		 * Only pass this when the icon is the *sole* carrier of meaning. Icons that
		 * sit beside a text label must stay `aria-hidden`, or a screen reader reads
		 * the same thing twice.
		 */
		label?: string;
	}

	let {
		name,
		size = 20,
		stroke = 2,
		filled = false,
		class: className = '',
		label
	}: Props = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill={filled ? 'currentColor' : 'none'}
	stroke="currentColor"
	stroke-width={filled ? 0 : stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	class="flex-shrink-0 {className}"
	role={label ? 'img' : 'presentation'}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	<path d={icons[name]} />
</svg>
