<script lang="ts">
	import { resolve } from '$app/paths';
	import tmdbLogo from '$lib/assets/tmdb.svg';
	import { CONTACT_EMAIL, CONTACT_MAILTO } from '$lib/contact';

	/**
	 * Attribution, the way to reach us, and the legal links.
	 *
	 * The TMDB notice is not decoration: their API terms require this exact
	 * sentence and their unmodified logo, kept less prominent than the app's own
	 * branding. Every title, poster, rating and air date in here comes from them,
	 * so the credit belongs on every page rather than buried on one.
	 */
</script>

<footer class="mt-auto border-t border-line/70">
	<div
		class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-7 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between sm:px-6"
	>
		<div class="flex items-start gap-3">
			<!-- Linked and unmodified, at a size that stays below the app wordmark. -->
			<a
				href="https://www.themoviedb.org"
				target="_blank"
				rel="noopener noreferrer"
				class="-m-2.5 mt-0.5 flex flex-shrink-0 items-center p-2.5 transition-opacity duration-200 hover:opacity-80"
			>
				<img src={tmdbLogo} alt="The Movie Database" width="72" height="9" />
			</a>
			<p class="max-w-sm leading-relaxed">
				This product uses the TMDB API but is not endorsed or certified by TMDB.
			</p>
		</div>

		<!--
			`-my-2.5` with matching padding: the links keep their position and their
			spacing, and gain the vertical hit area a thumb needs. A 16px-tall legal
			link is a link you have to aim at.

			The address is spelled out rather than hidden behind the word "Contact":
			it is the one thing on this page somebody may want to copy, write down or
			reach from a machine that has no mail client wired up.

			`rel="external"` on the mailto: it hands the click to the mail client
			instead of the SvelteKit router, which is what a scheme the router cannot
			navigate needs anyway.
		-->
		<nav aria-label="Footer" class="-my-2.5 flex flex-shrink-0 items-center gap-2">
			<a
				href={CONTACT_MAILTO}
				rel="external"
				class="px-2 py-2.5 transition-colors duration-200 hover:text-ink"
			>
				{CONTACT_EMAIL}
			</a>
			<a href={resolve('/terms')} class="px-2 py-2.5 transition-colors duration-200 hover:text-ink">
				Terms
			</a>
			<a
				href={resolve('/privacy')}
				class="px-2 py-2.5 transition-colors duration-200 hover:text-ink"
			>
				Privacy
			</a>
		</nav>
	</div>
</footer>
