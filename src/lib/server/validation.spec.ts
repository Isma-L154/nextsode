import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { parseFields, positiveInt, readForm } from './validation';

const schema = v.strictObject({ id: positiveInt });

function post(body: BodyInit) {
	return new Request('http://localhost/', { method: 'POST', body });
}

describe('parseFields', () => {
	it('returns the declared fields, parsed', () => {
		expect(parseFields(schema, new URLSearchParams('id=42'))).toEqual({ id: 42 });
	});

	it('refuses a field that appears twice', () => {
		expect(parseFields(schema, new URLSearchParams('id=1&id=2'))).toBeNull();
	});

	it('refuses a field named after an Object.prototype member', () => {
		const loose = v.object({ id: positiveInt });

		expect(parseFields(loose, new URLSearchParams('id=1&constructor=x'))).toBeNull();
		expect(parseFields(loose, new URLSearchParams('id=1&__proto__=x'))).toBeNull();
	});
});

describe('readForm', () => {
	it('refuses an uploaded file', async () => {
		const form = new FormData();
		form.set('id', new File(['1'], 'id.txt'));

		expect(await readForm(post(form), schema)).toBeNull();
	});

	it('refuses a body that is not a form', async () => {
		expect(await readForm(post('{"id":1}'), schema)).toBeNull();
	});
});
