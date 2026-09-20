<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Seo from '$lib/components/Seo.svelte';
	import { pageSchema } from '$lib/format/seo';
	import Prose from '$lib/components/ui/Prose.svelte';
	import { CONTACT_EMAIL, CONTACT_MAILTO } from '$lib/contact';

	// Declared once: the meta tags and the structured data have to agree, and
	// two copies of a sentence are two chances for them to drift apart.
	const TITLE = 'Terms of Use — Nextsode';
	const DESCRIPTION =
		'The terms that apply to using Nextsode: a free, personal watchlist for films and TV shows.';
</script>

<Seo
	title={TITLE}
	description={DESCRIPTION}
	origin={page.data.origin}
	path="/terms"
	schema={pageSchema(page.data.origin, '/terms', TITLE, DESCRIPTION)}
/>

<Prose title="Terms of Use" updated="20 September 2026">
	<p>
		Nextsode is a free service for keeping a personal list of films and TV shows and tracking how
		far into a series you are. By using it you agree to what follows. If you do not, please do not
		use it.
	</p>

	<h2>What this is, and what it is not</h2>
	<p>
		Nextsode is a personal project, offered free of charge and with no commercial guarantee behind
		it. It is <strong>not</strong> a streaming service: it holds no films or episodes, and plays nothing.
		It records what you intend to watch and where you got to.
	</p>

	<h2>Your account</h2>
	<ul>
		<li>You sign in with a Google account. You need to be old enough to hold one.</li>
		<li>
			You are responsible for what happens under your account. Keep your Google account secure.
		</li>
		<li>One person, one account. Do not create accounts automatically or in bulk.</li>
		<li>
			You can delete your account, and everything in it, at any time from the
			<a href={resolve('/privacy')}>privacy page</a>.
		</li>
	</ul>

	<h2>Fair use</h2>
	<p>The service runs on shared, rate-limited resources. Please do not:</p>
	<ul>
		<li>send automated traffic, scrape it, or use it as a proxy to another API;</li>
		<li>attempt to reach data belonging to another account;</li>
		<li>
			probe, attack or overload the service, or work around any limit or security measure in it;
		</li>
		<li>use it for anything illegal, or to store anything unlawful.</li>
	</ul>
	<p>
		Accounts that do any of this may be suspended or deleted without notice. Genuine security
		research is welcome — please report what you find rather than exploiting it.
	</p>

	<h2>Content about films and shows</h2>
	<p>
		Titles, posters, summaries, ratings, air dates and streaming availability come from
		<a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">TMDB</a>
		and its partners. That material belongs to them or to the respective rights holders, not to Nextsode,
		and is shown here under their API terms. This product uses the TMDB API but is not endorsed or certified
		by TMDB. Availability data is provided by JustWatch.
	</p>
	<p>
		Nextsode cannot guarantee that any of it is accurate or current. Air dates move, and where
		something can be watched changes constantly.
	</p>

	<h2>No warranty</h2>
	<p>
		The service is provided <strong>as is</strong>, with no warranty of any kind. There is no uptime
		commitment, no guarantee that your data will survive a fault, and no promise that the service
		will continue to exist. It may change, break or shut down at any time. Keep your own copy of
		anything you would be sorry to lose.
	</p>
	<p>
		To the fullest extent the law allows, the operator of Nextsode is not liable for any loss
		arising from your use of it — including lost data or missed releases.
	</p>

	<h2>Ending it</h2>
	<p>
		You may stop using Nextsode and delete your account whenever you like. Access may be withdrawn
		if these terms are broken, or if the service is discontinued.
	</p>

	<h2>Changes</h2>
	<p>
		These terms may be updated. The date at the top says when they last changed; continuing to use
		the service after that means the new version applies.
	</p>

	<h2>Contact</h2>
	<p>
		Questions about these terms, or about the service, can be sent to
		<a href={CONTACT_MAILTO} rel="external">{CONTACT_EMAIL}</a>. Bugs and feature requests are
		better raised on the
		<a href="https://github.com/Isma-L154/nextsode" target="_blank" rel="noopener noreferrer">
			project repository
		</a>, where other people can see them.
	</p>
</Prose>
