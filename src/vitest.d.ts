import 'vitest';

declare module 'vitest' {
	export interface ProvidedContext {
		testAppPassword: string;
	}
}
