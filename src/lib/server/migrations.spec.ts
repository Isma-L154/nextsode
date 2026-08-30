import { beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createTestDatabase, seedUser, type TestDatabase } from './test-db';
import { watchlistItem } from './db/schema';

/**
 * The one-time repair in `0008`, run as the file that ships.
 *
 * Data migrations are the kind nobody looks at twice: they run once, against
 * rows nobody can see, and a wrong `WHERE` is only noticed later as titles that
 * quietly went missing. This one exists to stop exactly that, so it is worth
 * pointing a real engine at the actual SQL rather than trusting the reading.
 */

let harness: TestDatabase;

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

async function overdueRepair() {
	const sql = await readFile('./drizzle/0008_restart_overdue_countdowns.sql', 'utf8');
	await harness.client.execute(sql);
}

/** Whole days since the row was stamped watched; null when it has no stamp. */
async function ageInDays(id: string): Promise<number | null> {
	const [row] = await harness.db.select().from(watchlistItem);
	expect(row.id).toBe(id);
	return row.watchedAt === null ? null : Math.round((Date.now() - row.watchedAt.getTime()) / DAY);
}

beforeEach(async () => {
	harness = await createTestDatabase();
});

describe('0008 — restart overdue countdowns', () => {
	/** One account with a window, and one saved title. */
	async function listWith(
		autoDeleteDays: number | null,
		item: Partial<typeof watchlistItem.$inferInsert>
	) {
		await seedUser(harness.db, { autoDeleteDays });
		await harness.db.insert(watchlistItem).values({
			id: 'item-1',
			userId: 'user-1',
			tmdbId: 1,
			mediaType: 'movie',
			title: 'Arrival',
			...item
		});
	}

	/**
	 * The case the migration exists for: an archived title handed back already
	 * past its window, which the next page load would delete outright having
	 * never warned about it.
	 */
	it('restarts the clock on a title stranded past its window', async () => {
		await listWith(7, { watched: true, watchedAt: daysAgo(40) });

		await overdueRepair();

		expect(await ageInDays('item-1')).toBe(0);
	});

	it('leaves a title that is still inside its window alone', async () => {
		await listWith(30, { watched: true, watchedAt: daysAgo(10) });

		await overdueRepair();

		expect(await ageInDays('item-1')).toBe(10);
	});

	// Nothing is on a countdown at all, so there is nothing to rescue and no
	// reason to rewrite a timestamp the owner may still be reading.
	it('leaves every list with the feature switched off untouched', async () => {
		await listWith(null, { watched: true, watchedAt: daysAgo(400) });

		await overdueRepair();

		expect(await ageInDays('item-1')).toBe(400);
	});

	it('leaves an unwatched title untouched, however old', async () => {
		await listWith(7, { watched: false, watchedAt: null });

		await overdueRepair();

		expect(await ageInDays('item-1')).toBeNull();
	});

	it('is safe to have run already — a second pass changes nothing', async () => {
		await listWith(7, { watched: true, watchedAt: daysAgo(40) });

		await overdueRepair();
		await overdueRepair();

		expect(await ageInDays('item-1')).toBe(0);
	});
});
