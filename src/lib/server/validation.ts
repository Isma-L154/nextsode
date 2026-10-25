import * as v from 'valibot';

/**
 * The one way request input gets in.
 *
 * Every field a form, a query string or a path carries is attacker-controlled,
 * whatever the page that produced it looked like. Each route declares the
 * fields it accepts as a schema, and anything else is refused rather than
 * repaired: an unknown or repeated field, an uploaded file, a value out of
 * range or too long. Repairing it — truncating, clamping, falling back to a
 * default — would store something nobody sent.
 */

/** Big enough for the largest form here (a save with its overview), no more. */
const MAX_FORM_BYTES = 32 * 1024;

type FieldsSchema = v.GenericSchema;

/**
 * The submitted fields as a flat record, or null when one repeats or is a file.
 * Names that collide with `Object.prototype` count as repeats.
 */
function flatten(entries: Iterable<[string, FormDataEntryValue]>): Record<string, string> | null {
	const record: Record<string, string> = {};
	for (const [name, value] of entries) {
		if (typeof value !== 'string' || name in record) return null;
		record[name] = value;
	}
	return record;
}

/** Fields from a query string or path parameters, or null when they do not match. */
export function parseFields<T extends FieldsSchema>(
	schema: T,
	entries: Iterable<[string, FormDataEntryValue]>
): v.InferOutput<T> | null {
	const record = flatten(entries);
	if (!record) return null;
	const result = v.safeParse(schema, record);
	return result.success ? result.output : null;
}

/**
 * The body's bytes, or null past `MAX_FORM_BYTES`. Counted as they arrive, not
 * taken from `content-length`, which a client may omit or understate.
 */
async function readBounded(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
	if (!request.body) return new Uint8Array();

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_FORM_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}

	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

/** A form body, or null when it is too large or does not match. */
export async function readForm<T extends FieldsSchema>(
	request: Request,
	schema: T
): Promise<v.InferOutput<T> | null> {
	const bytes = await readBounded(request);
	if (!bytes) return null;

	const contentType = request.headers.get('content-type') ?? '';
	try {
		const form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
		return parseFields(schema, form);
	} catch {
		// A body that does not parse as a form at all.
		return null;
	}
}

/** Answered for any form body that `readForm` refuses. */
export const INVALID_FORM = { message: 'That request was not valid.' };

/** An id this app generated: never empty, and bounded. */
export const rowId = v.pipe(v.string(), v.minLength(1), v.maxLength(64));

/** A TMDB id, written the one way an id is written. */
export const positiveInt = v.pipe(v.string(), v.regex(/^[1-9]\d{0,8}$/), v.transform(Number));

/** A season or episode count, where zero is a real answer. */
export const count = v.pipe(v.string(), v.regex(/^(0|[1-9]\d{0,3})$/), v.transform(Number));

export const mediaType = v.picklist(['movie', 'tv']);

/** A share or calendar token: 256 bits as lowercase hex. */
export const token = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));

/** Text that must be there, trimmed, and refused when longer than `max`. */
export const requiredText = (max: number) =>
	v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(max));

/** Text that may be empty, which is stored as null. */
export const optionalText = (max: number) =>
	v.pipe(
		v.string(),
		v.trim(),
		v.maxLength(max),
		v.transform((text) => text || null)
	);

/** A ticked checkbox sends `on`; an unticked one sends nothing. */
export const checkbox = v.optional(v.literal('on'));
