import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { version } from '$app/env';
import { SESSION_COOKIE } from '#lib/server/auth.js';
import { cacheSignedOutPages, type PageStore } from './page-cache';

const TITLE_URL = 'https://example.test/title/movie/inception-27205';

function createStore() {
	const entries = new Map<string, Response>();
	const store = {
		match: vi.fn(async (key: Request) => entries.get(key.url)?.clone()),
		put: vi.fn(async (key: Request, response: Response) => {
			entries.set(key.url, response.clone());
		})
	} satisfies PageStore;
	return { entries, store };
}

function createEvent({
	url = TITLE_URL,
	method = 'GET',
	country = 'cr',
	session,
	isDataRequest = false,
	isSubRequest = false
}: {
	url?: string;
	method?: string;
	country?: string;
	session?: string;
	isDataRequest?: boolean;
	isSubRequest?: boolean;
} = {}): RequestEvent {
	return {
		url: new URL(url),
		request: new Request(url, {
			method,
			headers: { 'cf-ipcountry': country, range: 'bytes=0-5', 'if-none-match': 'old' }
		}),
		cookies: { get: (name: string) => (name === SESSION_COOKIE ? session : undefined) },
		locals: { user: null },
		isDataRequest,
		isSubRequest
	} as RequestEvent;
}

function renderedPage(body = 'the title') {
	return new Response(body, {
		headers: {
			'cache-control': 'private, no-store',
			'content-security-policy': "script-src 'sha256-title'",
			'x-content-type-options': 'nosniff'
		}
	});
}

afterEach(() => vi.restoreAllMocks());

describe('cacheSignedOutPages', () => {
	it('stores a miss by path, country and build while leaving the returned response intact', async () => {
		const { entries, store } = createStore();
		const rendered = renderedPage();
		const resolve = vi.fn(async () => rendered);
		const response = await cacheSignedOutPages(() => store)({ event: createEvent(), resolve });

		expect(resolve).toHaveBeenCalledOnce();
		expect(entries.size).toBe(1);
		const key = store.put.mock.calls[0][0];
		expect(key.url).toBe(`${TITLE_URL}?country=CR&build=${version}`);
		expect([...key.headers]).toEqual([]);
		const stored = entries.get(key.url)!;
		expect(stored.headers.get('cache-control')).toBe('public, s-maxage=21600');
		expect(stored.headers.get('content-security-policy')).toBe("script-src 'sha256-title'");
		expect(response).toBe(rendered);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(await response.text()).toBe('the title');
		expect(await stored.text()).toBe('the title');
	});

	it('answers a second request from the store with private browser caching', async () => {
		const { entries, store } = createStore();
		const handle = cacheSignedOutPages(() => store);
		await handle({ event: createEvent(), resolve: vi.fn(async () => renderedPage()) });
		const resolve = vi.fn(async () => renderedPage('another render'));

		const response = await handle({ event: createEvent(), resolve });

		expect(resolve).not.toHaveBeenCalled();
		expect(await response.text()).toBe('the title');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('content-security-policy')).toBe("script-src 'sha256-title'");
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.has('vary')).toBe(false);
		expect([...entries.values()][0].headers.get('cache-control')).toBe('public, s-maxage=21600');
		expect(store.put).toHaveBeenCalledOnce();
	});

	it('keeps countries separate on both misses and hits', async () => {
		const { entries, store } = createStore();
		const handle = cacheSignedOutPages(() => store);
		for (const country of ['CR', 'US']) {
			const response = await handle({
				event: createEvent({ country }),
				resolve: vi.fn(async () => renderedPage(`offers for ${country}`))
			});
			expect(await response.text()).toBe(`offers for ${country}`);
		}
		for (const country of ['CR', 'US']) {
			const resolve = vi.fn(async () => renderedPage('wrong country'));
			const response = await handle({ event: createEvent({ country }), resolve });
			expect(await response.text()).toBe(`offers for ${country}`);
			expect(resolve).not.toHaveBeenCalled();
		}
		expect(entries.size).toBe(2);
	});

	it.each(['session-token', ''])(
		'bypasses an existing entry with session cookie %j',
		async (session) => {
			const { store } = createStore();
			const handle = cacheSignedOutPages(() => store);
			await handle({ event: createEvent(), resolve: vi.fn(async () => renderedPage()) });
			store.match.mockClear();
			store.put.mockClear();
			const getStore = vi.fn(() => store);
			const rendered = renderedPage('personal page');
			const resolve = vi.fn(async () => rendered);

			const response = await cacheSignedOutPages(getStore)({
				event: createEvent({ session }),
				resolve
			});

			expect(response).toBe(rendered);
			expect(resolve).toHaveBeenCalledOnce();
			expect(getStore).not.toHaveBeenCalled();
			expect(store.match).not.toHaveBeenCalled();
			expect(store.put).not.toHaveBeenCalled();
		}
	);

	it.each([
		{ method: 'POST' },
		{ method: 'HEAD' },
		{ url: `${TITLE_URL}?country=US` },
		{ isDataRequest: true },
		{ isSubRequest: true },
		{ url: 'https://example.test/watchlist' }
	])('bypasses ineligible requests: %j', async (options) => {
		const { store } = createStore();
		const rendered = renderedPage();
		const resolve = vi.fn(async () => rendered);
		const response = await cacheSignedOutPages(() => store)({
			event: createEvent(options),
			resolve
		});

		expect(response).toBe(rendered);
		expect(resolve).toHaveBeenCalledOnce();
		expect(store.match).not.toHaveBeenCalled();
		expect(store.put).not.toHaveBeenCalled();
	});

	it.each([301, 404, 502])('does not store a %i response', async (status) => {
		const { entries, store } = createStore();
		const rendered = new Response('not a title', { status });
		const response = await cacheSignedOutPages(() => store)({
			event: createEvent(),
			resolve: vi.fn(async () => rendered)
		});

		expect(response).toBe(rendered);
		expect(entries.size).toBe(0);
		expect(store.put).not.toHaveBeenCalled();
	});

	it('does not store a response that sets a cookie', async () => {
		const { store } = createStore();
		const rendered = renderedPage();
		rendered.headers.set('set-cookie', 'preference=value; Path=/');
		const response = await cacheSignedOutPages(() => store)({
			event: createEvent(),
			resolve: vi.fn(async () => rendered)
		});

		expect(response).toBe(rendered);
		expect(store.put).not.toHaveBeenCalled();
	});

	it('does not store a response personalized during resolve', async () => {
		const { store } = createStore();
		const event = createEvent();
		const rendered = renderedPage('personal page');
		const response = await cacheSignedOutPages(() => store)({
			event,
			resolve: vi.fn(async () => {
				event.locals.user = {
					id: 'alice',
					name: 'Alice',
					email: 'alice@example.test',
					avatarUrl: null
				};
				return rendered;
			})
		});

		expect(response).toBe(rendered);
		expect(store.put).not.toHaveBeenCalled();
	});

	it('passes through when no store exists', async () => {
		// Node has no edge cache, so `vite dev` and the tests take this path on
		// every title request; it must not read as a failing cache.
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const rendered = renderedPage();
		const resolve = vi.fn(async () => rendered);
		const response = await cacheSignedOutPages(() => undefined)({ event: createEvent(), resolve });

		expect(response).toBe(rendered);
		expect(resolve).toHaveBeenCalledOnce();
		expect(log).not.toHaveBeenCalled();
	});

	it('treats a throwing match as a miss', async () => {
		const { store } = createStore();
		const failure = new Error('cache unavailable');
		store.match.mockImplementation(() => {
			throw failure;
		});
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const rendered = renderedPage();
		const resolve = vi.fn(async () => rendered);
		const response = await cacheSignedOutPages(() => store)({ event: createEvent(), resolve });

		expect(response).toBe(rendered);
		expect(await response.text()).toBe('the title');
		expect(resolve).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalledWith(expect.any(String), failure);
	});

	it('returns the rendered response when put rejects', async () => {
		const { store } = createStore();
		const failure = new Error('cache full');
		store.put.mockRejectedValue(failure);
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const rendered = renderedPage();
		const response = await cacheSignedOutPages(() => store)({
			event: createEvent(),
			resolve: vi.fn(async () => rendered)
		});

		expect(response).toBe(rendered);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(await response.text()).toBe('the title');
		expect(log).toHaveBeenCalledWith(expect.any(String), failure);
	});
});
