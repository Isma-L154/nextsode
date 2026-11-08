import { describe, expect, it } from 'vitest';
import { resolveCountry } from './country';

describe('resolveCountry', () => {
	it.each([
		['cr', 'CR'],
		['Gb', 'GB'],
		['US', 'US']
	])('returns %s as %s', (country, expected) => {
		const request = new Request('https://example.test', {
			headers: { 'cf-ipcountry': country }
		});

		expect(resolveCountry(request)).toBe(expected);
	});

	it.each([undefined, '', 'XX', 'xx', 'T1', 'U', 'USA', '1A', 'U-S'])(
		'falls back to US for %s',
		(country) => {
			const request = new Request('https://example.test', {
				headers: country === undefined ? {} : { 'cf-ipcountry': country }
			});

			expect(resolveCountry(request)).toBe('US');
		}
	);
});
