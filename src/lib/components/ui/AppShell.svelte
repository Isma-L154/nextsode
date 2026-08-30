<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Icon, { type IconName } from './Icon.svelte';
	import AccountChip from '$lib/components/auth/AccountChip.svelte';
	import Footer from './Footer.svelte';
	import { homeReset } from '$lib/stores/home-reset.svelte';
	import GoogleButton from '$lib/components/auth/GoogleButton.svelte';
	import type { SessionUser } from '$lib/types';

	/**
	 * The application frame: brand, navigation and account, wrapped around the
	 * routed page.
	 *
	 * Navigation is duplicated by breakpoint on purpose. On a phone the tabs sit
	 * at the bottom, inside the thumb arc; on a pointer device they sit in the top
	 * bar, where a persistent bottom strip would just eat vertical space. Only one
	 * is ever rendered visibly, and both drive the same routes — so the tab order
	 * a keyboard user walks matches what they see.
	 */
	interface Props {
		user: SessionUser | null;
		authAvailable: boolean;
		/** How many titles are still to watch, badged on the My List tab. */
		toWatchCount: number;
		children: Snippet;
	}

	let { user, authAvailable, toWatchCount, children }: Props = $props();

	interface NavItem {
		href: '/' | '/watchlist';
		label: string;
		icon: IconName;
		/** Rendered as a badge; omitted when zero. */
		badge?: number;
		/** What the badge counts, for anyone who cannot see it sitting on a tab. */
		badgeLabel?: string;
	}

	const navItems = $derived<NavItem[]>([
		{ href: '/', label: 'Discover', icon: 'compass' },
		{
			href: '/watchlist',
			label: 'My List',
			icon: 'bookmark',
			badge: toWatchCount,
			badgeLabel: 'to watch'
		}
	]);

	const currentPath = $derived(page.url.pathname);

	/** Exact match: with only two top-level routes, prefix matching would make "/" active everywhere. */
	function isActive(href: string): boolean {
		return currentPath === href;
	}
</script>

{#snippet badge(count: number | undefined, label: string | undefined, active: boolean)}
	{#if count}
		<span
			class="rounded-full px-1.5 py-px text-[10px] leading-tight font-bold tabular-nums transition-colors duration-200
				{active ? 'bg-brand text-white' : 'bg-surface-hi text-ink-muted'}"
		>
			{count > 99 ? '99+' : count}
			<!-- A bare number next to a tab name reads as "My List 4", which says
			     nothing about what the four are. -->
			{#if label}<span class="sr-only">{label}</span>{/if}
		</span>
	{/if}
{/snippet}

<a
	href="#main"
	class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
>
	Skip to content
</a>

<div class="flex min-h-dvh flex-col">
	<header
		class="sticky top-0 z-30 border-b border-line/70 bg-canvas/80 backdrop-blur-xl supports-[backdrop-filter]:bg-canvas/60"
	>
		<div
			class="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:h-16 sm:gap-6 sm:px-6"
		>
			<!--
				Stays a real link — middle-click, "open in new tab" and a crawler all
				need the href. The handler is what makes it work in the one case the
				href cannot: on Discover the target is the URL you are already on, so
				nothing navigates and the page keeps whatever was typed into it.
			-->
			<a
				href={resolve('/')}
				onclick={() => homeReset.request()}
				class="flex min-h-11 flex-shrink-0 items-center gap-2 transition-opacity duration-200 hover:opacity-80"
			>
				<span
					class="flex h-8 w-8 items-center justify-center rounded-xl bg-brand text-white shadow-lg shadow-brand/25"
				>
					<Icon name="film" size={18} />
				</span>
				<span class="font-display text-lg font-extrabold tracking-tight sm:text-xl">
					Next<span class="text-brand-hi">sode</span>
				</span>
			</a>

			<!-- Desktop navigation. Hidden on phones, where the bottom bar takes over. -->
			<nav aria-label="Main" class="hidden flex-1 sm:block">
				<ul class="flex items-center gap-1">
					{#each navItems as item (item.href)}
						{@const active = isActive(item.href)}
						<li>
							<a
								href={resolve(item.href)}
								aria-current={active ? 'page' : undefined}
								class="flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors duration-200
									{active ? 'bg-surface-hi text-ink' : 'text-ink-muted hover:bg-surface/70 hover:text-ink'}"
							>
								<Icon name={item.icon} size={17} />
								{item.label}
								{@render badge(item.badge, item.badgeLabel, active)}
							</a>
						</li>
					{/each}
				</ul>
			</nav>

			<div class="ml-auto flex-shrink-0 sm:ml-0">
				{#if user}
					<AccountChip {user} />
				{:else if authAvailable}
					<GoogleButton />
				{/if}
			</div>
		</div>
	</header>

	<!--
		Bottom padding on mobile clears the fixed tab bar; without it the last row
		of posters sits permanently underneath it and can never be scrolled clear.
	-->
	<main id="main" class="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
		{@render children()}
	</main>

	<!-- Bottom padding lives here rather than on `main`, so the required TMDB
	     credit sits above the phone tab bar instead of behind it. -->
	<div class="pb-28 sm:pb-20"><Footer /></div>

	<!-- Mobile navigation: fixed to the bottom, inside the thumb arc. -->
	<nav
		aria-label="Main"
		class="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-canvas/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden"
	>
		<ul class="flex items-stretch">
			{#each navItems as item (item.href)}
				{@const active = isActive(item.href)}
				<li class="flex-1">
					<a
						href={resolve(item.href)}
						aria-current={active ? 'page' : undefined}
						class="flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-2 py-2 text-[11px] font-semibold transition-colors duration-200
							{active ? 'text-brand-hi' : 'text-ink-faint'}"
					>
						<span class="relative">
							<!-- Active state is carried by colour *and* stroke weight, so it
							     survives a greyscale or colour-blind rendering. -->
							<Icon name={item.icon} size={22} stroke={active ? 2.4 : 1.8} />
							<!-- The dot repeats the count as presence-only, because a full
							     numeric badge at this size is unreadable on a phone. -->
							{#if item.badge}
								<span
									class="absolute -top-0.5 -right-1 h-2 w-2 rounded-full border-2 border-canvas
										{active ? 'bg-brand-hi' : 'bg-ink-faint'}"
								></span>
								<span class="sr-only">{item.badge} {item.badgeLabel ?? ''}</span>
							{/if}
						</span>
						{item.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>
</div>
