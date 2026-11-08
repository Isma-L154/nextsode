/**
 * Which country's streaming offers to show.
 *
 * Cloudflare resolves this at the edge and hands it over as a header, so it
 * costs nothing and needs no permission prompt — unlike the geolocation API,
 * which would be a wildly disproportionate ask for "which Netflix is yours".
 *
 * Falls back to US, which is the country TMDB has the most complete data for.
 */
export function resolveCountry(request: Request): string {
	const header = request.headers.get('cf-ipcountry')?.toUpperCase();
	// `XX` is Cloudflare's marker for an unknown or reserved client, and `T1`
	// means Tor — neither maps to a real TMDB region. Two capital letters is also
	// what `/api/details` accepts, so whatever this returns is a valid query.
	if (!header || !/^[A-Z]{2}$/.test(header) || header === 'XX') return 'US';
	return header;
}
