import { and, eq, sql } from 'drizzle-orm';
import type { MediaDetails, SessionUser } from '#lib/types.js';
import { media, user, watchlistItem } from '../db/schema';
import { withUser } from '../db/user';
import { getDetails } from '../tmdb';
import { seasonInfoFromDetails } from './seasons';

/**
 * Ceiling on how many titles one account may store.
 *
 * Far above any realistic list, but it stops a signed-in account from growing
 * the shared database without bound — the database is a finite resource
 * shared by every user of the deployment.
 */
const MAX_ITEMS_PER_USER = 5000;

type TitleIdentity = Pick<MediaDetails, 'tmdbId' | 'mediaType'>;

export function findTitleForSave(viewer: SessionUser, { tmdbId, mediaType }: TitleIdentity) {
	return withUser(viewer, async (db) => {
		/**
		 * Checking for the duplicate up front avoids spending a TMDB request on a
		 * save that would be discarded anyway. The unique index is the backstop
		 * for concurrent saves of the same title.
		 */
		const [duplicate] = await db
			.select({ id: watchlistItem.id })
			.from(watchlistItem)
			.innerJoin(media, eq(watchlistItem.mediaId, media.id))
			.where(
				and(
					eq(watchlistItem.userId, viewer.id),
					eq(media.tmdbId, tmdbId),
					eq(media.mediaType, mediaType)
				)
			)
			.limit(1);
		if (duplicate) return { duplicate: true, title: undefined };
		const [title] = await db
			.select()
			.from(media)
			.where(and(eq(media.tmdbId, tmdbId), eq(media.mediaType, mediaType)))
			.limit(1);
		return { duplicate: false, title };
	});
}

export async function fetchMediaForSave({
	tmdbId,
	mediaType
}: TitleIdentity): Promise<typeof media.$inferInsert> {
	const details = await getDetails(mediaType, tmdbId);
	return {
		tmdbId,
		mediaType,
		title: details.title,
		posterPath: details.posterPath,
		releaseDate: details.releaseDate || null,
		overview: details.overview,
		voteAverage: details.voteAverage,
		...(mediaType === 'tv' ? seasonInfoFromDetails(details) : {})
	};
}

export function saveWatchlistItem(
	viewer: SessionUser,
	{ tmdbId, mediaType }: TitleIdentity,
	existing: typeof media.$inferSelect | undefined,
	metadata: typeof media.$inferInsert | undefined
): Promise<'full' | 'added' | 'duplicate'> {
	return withUser(viewer, async (db) => {
		// Serialize adds for this owner before counting, including different titles.
		await db.select({ id: user.id }).from(user).where(eq(user.id, viewer.id)).for('update');
		const [stats] = await db
			.select({ total: sql<string>`count(*)` })
			.from(watchlistItem)
			.where(eq(watchlistItem.userId, viewer.id));
		if (Number(stats?.total ?? 0) >= MAX_ITEMS_PER_USER) return 'full';
		let title = existing;
		if (metadata) {
			// Another owner can have saved this title while TMDB was answering.
			[title] = await db.insert(media).values(metadata).onConflictDoNothing().returning();
			if (!title)
				[title] = await db
					.select()
					.from(media)
					.where(and(eq(media.tmdbId, tmdbId), eq(media.mediaType, mediaType)))
					.limit(1);
		}
		if (!title) throw new Error('Saved media could not be resolved');
		const inserted = await db
			.insert(watchlistItem)
			.values({ userId: viewer.id, mediaId: title.id })
			.onConflictDoNothing()
			.returning({ id: watchlistItem.id });
		return inserted.length > 0 ? 'added' : 'duplicate';
	});
}
