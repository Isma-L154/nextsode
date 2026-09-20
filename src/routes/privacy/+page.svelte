<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { pageSchema } from '$lib/format/seo';
	import Prose from '$lib/components/ui/Prose.svelte';
	import { CONTACT_EMAIL, CONTACT_MAILTO } from '$lib/contact';

	const signedIn = $derived(Boolean(page.data.user));

	// Declared once: the meta tags and the structured data have to agree, and
	// two copies of a sentence are two chances for them to drift apart.
	const TITLE = 'Privacy — Nextsode';
	const DESCRIPTION =
		'What Nextsode stores, who processes it, and how to delete everything. No tracking, no advertising, no profiling.';
</script>

<Seo
	title={TITLE}
	description={DESCRIPTION}
	origin={page.data.origin}
	path="/privacy"
	schema={pageSchema(page.data.origin, '/privacy', TITLE, DESCRIPTION)}
/>

<Prose title="Privacy" updated="20 September 2026">
	<p>
		The short version: Nextsode keeps the least it can get away with, shows you no advertising,
		tracks you nowhere, and lets you delete everything from this page in one step.
	</p>

	<h2>What is stored</h2>
	<ul>
		<li>
			<strong>Your Google identifier</strong> — the stable id Google issues for your account, used to
			recognise you when you come back.
		</li>
		<li><strong>Your email, name and profile picture URL</strong>, as Google reports them.</li>
		<li>
			<strong>Your list</strong> — which titles you saved, whether you have watched them, how far into
			a series you are, and the dates those things happened.
		</li>
		<li>
			<strong>Your session</strong> — as a one-way hash. The browser holds a random token; the database
			holds only its SHA-256 digest, so a copy of the database cannot be replayed as a login.
		</li>
	</ul>

	<h2>What is not stored</h2>
	<ul>
		<li>
			<strong>No Google tokens.</strong> The access token from signing in is used once, to read your name
			and email, and then discarded. Nextsode cannot reach anything else in your Google account and holds
			no key to it.
		</li>
		<li><strong>No password.</strong> Google does the authenticating.</li>
		<li>
			<strong>No analytics, no advertising, no third-party trackers, no fingerprinting.</strong>
		</li>
		<li>
			<strong>No cookies beyond the one that signs you in.</strong> It is httpOnly and exists only to
			keep you logged in.
		</li>
	</ul>

	<h2>Where your country and time zone come from</h2>
	<p>
		"Where to watch" needs a country, and the suggestion rows change over at your local midnight,
		which needs a time zone. Both are read from signals our host adds to the request at the network
		edge, derived from your connection. Neither is stored, and the browser location permission is
		never requested.
	</p>

	<h2>How suggestions are produced</h2>
	<p>
		From your own list, by a fixed rule: titles you finished or are part-way through are used to ask
		TMDB what is similar, and which of them gets asked about rotates by the day.
		<strong
			>There is no artificial intelligence, no machine learning and no profiling involved</strong
		>, here or anywhere else in the service. Nothing about you is sent to an advertising network or
		a recommendation broker, and no profile of you is built, sold or shared.
	</p>

	<h2>Who else handles it</h2>
	<ul>
		<li><strong>Google</strong> — authenticates you. Their privacy policy governs that part.</li>
		<li>
			<strong>Cloudflare</strong> — hosts and delivers the site, and as part of that processes connection
			data such as IP addresses.
		</li>
		<li><strong>Turso</strong> — runs the database your list is stored in.</li>
		<li>
			<strong>TMDB</strong> — answers questions about films and shows. Those requests are made by our
			server, not by your browser, and carry no identifier of yours.
		</li>
	</ul>
	<p>Your data is not sold, rented or shared with anyone else.</p>

	<h2>How long it is kept</h2>
	<p>
		Your list stays until you remove it or delete your account. Sessions expire on their own.
		Deleting your account removes everything immediately — it is not a flag, and there is no
		recovery window.
	</p>

	<h2>Delete everything</h2>
	<p>
		This removes your account, your entire list, your progress and every active session, in one step
		and permanently.
	</p>

	{#if signedIn}
		<details
			class="not-prose mt-4 rounded-2xl bg-surface/70 p-4 ring-1 ring-rose/25 [&_a]:no-underline"
		>
			<summary class="cursor-pointer text-sm font-semibold text-rose select-none">
				Delete my account
			</summary>

			<form method="POST" action="?/deleteAccount" use:enhance class="mt-4 space-y-3">
				<label class="flex items-start gap-2.5 text-xs text-ink-muted">
					<input
						type="checkbox"
						name="confirm"
						required
						class="mt-0.5 h-4 w-4 flex-shrink-0 accent-rose"
					/>
					<span>
						I understand this deletes my account and everything in it, and that it cannot be undone.
					</span>
				</label>
				<button
					type="submit"
					class="flex min-h-[40px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-rose/15 px-4 text-sm font-semibold text-rose ring-1 ring-rose/30 transition-colors duration-200 ring-inset hover:bg-rose/25"
				>
					<Icon name="trash" size={15} />
					Delete my account permanently
				</button>
			</form>
		</details>
	{:else}
		<p class="text-xs text-ink-faint">Sign in to delete an account.</p>
	{/if}

	<h2>Changes</h2>
	<p>
		This page may be updated; the date at the top says when it last changed. If what is collected
		ever materially changes, this page changes with it.
	</p>

	<h2>Contact</h2>
	<p>
		For anything about your data — including a copy of it — write to
		<a href={CONTACT_MAILTO} rel="external">{CONTACT_EMAIL}</a>.
	</p>
</Prose>
