import { describe, expect, it } from 'vitest';
import { seasonInfoFromDetails } from './seasons';

describe('seasonInfoFromDetails', () => {
	it('keeps aired and announced seasons separate', () => {
		expect(
			seasonInfoFromDetails({
				seasons: 4,
				airedSeasons: 3,
				upcomingSeason: { number: 4, airDate: '2027-01-01' }
			})
		).toEqual({
			totalSeasons: 4,
			airedSeasons: 3,
			nextSeasonNumber: 4,
			nextSeasonAirDate: '2027-01-01'
		});
	});

	it('keeps zero aired seasons and no announced season', () => {
		expect(seasonInfoFromDetails({ seasons: 1, airedSeasons: 0, upcomingSeason: null })).toEqual({
			totalSeasons: 1,
			airedSeasons: 0,
			nextSeasonNumber: null,
			nextSeasonAirDate: null
		});
	});

	it.each([
		{ seasons: null, airedSeasons: null },
		{ seasons: 0, airedSeasons: 0 },
		{ seasons: 201, airedSeasons: 3 },
		{ seasons: 3, airedSeasons: -1 },
		{ seasons: 3, airedSeasons: null }
	])('marks unusable season counts as resolved without data: %j', (counts) => {
		expect(
			seasonInfoFromDetails({
				...counts,
				upcomingSeason: { number: 4, airDate: '2027-01-01' }
			})
		).toEqual({
			totalSeasons: 0,
			airedSeasons: 0,
			nextSeasonNumber: null,
			nextSeasonAirDate: null
		});
	});
});
