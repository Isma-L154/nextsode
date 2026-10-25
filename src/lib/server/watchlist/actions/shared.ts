import * as v from 'valibot';
import { rowId } from '../../validation';

/** Returned by every action when the caller has no session. */
export const UNAUTHENTICATED = { message: 'Please sign in first.' };

/** The forms that only name the row they act on. */
export const rowForm = v.strictObject({ id: rowId });
