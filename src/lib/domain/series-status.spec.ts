import { describe, expect, it } from 'vitest';
import { seriesStatus } from './series-status';

const NOW = new Date(2026, 10, 4);

const airing = {
	mediaType: 'tv' as const,
	releaseDate: '2022-02-18',
	productionStatus: 'Returning Series',
	seasons: 3,
	airedSeasons: 2,
	upcomingSeason: null,
	nextEpisode: null
};

describe('seriesStatus', () => {
	it('names the next episode and its date', () => {
		const status = seriesStatus(
			{ ...airing, nextEpisode: { season: 3, episode: 4, airDate: '2026-11-12' } },
			NOW
		);

		expect(status).toEqual({
			label: 'Returning series',
			detail: 'Next episode: S3 E4 · Thursday, November 12, 2026'
		});
	});

	it('falls back to the announced season', () => {
		const dated = seriesStatus(
			{ ...airing, upcomingSeason: { number: 3, airDate: '2027-03' } },
			NOW
		);
		const undated = seriesStatus({ ...airing, upcomingSeason: { number: 3, airDate: null } }, NOW);

		expect(dated?.detail).toBe('Season 3 premieres March 2027');
		expect(undated?.detail).toBe('Season 3 announced, no date yet');
	});

	it('says how long a finished series ran', () => {
		const status = seriesStatus({ ...airing, productionStatus: 'Ended', airedSeasons: 5 }, NOW);

		expect(status).toEqual({ label: 'Ended', detail: '5 seasons aired' });
	});

	it('says nothing for films, unreleased series or a missing status', () => {
		expect(seriesStatus({ ...airing, mediaType: 'movie' }, NOW)).toBeNull();
		expect(seriesStatus({ ...airing, releaseDate: '2027-01-01' }, NOW)).toBeNull();
		expect(seriesStatus({ ...airing, productionStatus: null }, NOW)).toBeNull();
	});
});
