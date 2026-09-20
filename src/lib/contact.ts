/**
 * The public contact address, declared once.
 *
 * It appears in the footer of every page and in the Contact section of both
 * legal documents, and those three have to agree: a privacy policy that
 * promises a right to erasure is only worth the address it gives you, so a
 * stale copy in one of them is a broken promise, not a typo.
 *
 * The mailbox is a Cloudflare Email Routing alias on the apex domain rather
 * than a personal inbox, which keeps the private address off a public page and
 * lets the destination change without a deploy. See `docs/contact-email.md`.
 */
export const CONTACT_EMAIL = 'info@cloudils.com';

/** The `href` form, so no caller has to remember the scheme. */
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;
