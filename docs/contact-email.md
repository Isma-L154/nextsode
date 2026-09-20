# The contact address

How `info@cloudils.com` reaches a real inbox, and how to point another site at
the same mailbox.

## Why an alias and not a personal address

A personal address in a page footer is a personal address in every scraper's
list within a week. An alias on the apex domain gives the same reachability
with three properties a raw address does not have:

- the private destination never appears in public HTML, or in this repository;
- the destination can change without touching a deploy;
- one address serves every site on the domain, so a second project does not
  need a second mailbox.

Cloudflare Email Routing is the cheapest way to get all three: it is free, it
needs no mail server, and forwarding is a rule on the zone rather than code.

## What is configured

On the `cloudils.com` zone:

| Piece               | Value                                                         |
| ------------------- | ------------------------------------------------------------- |
| Routing rule        | `to: info@cloudils.com` → forward to the personal address     |
| Catch-all           | Disabled, action `drop`                                       |
| Destination address | Verified once from Cloudflare's confirmation mail             |
| DNS                 | Three `route*.mx.cloudflare.net` MX records, SPF and DKIM TXT |

Routing is receive-only. Nothing in this app sends mail, so Email **Sending**
is deliberately not onboarded — replies go out from the personal mailbox, from
its own address. That is a visible seam (you write to `info@`, the reply comes
from somewhere else), and the price of not running a mail server.

The catch-all stays on `drop` on purpose. A catch-all that forwards means every
dictionary-attack guess at `@cloudils.com` lands in the destination inbox, and
the whole point of the alias was to keep that inbox quiet.

## Reusing it on another site

The address is domain-wide, not app-specific, so another site on
`cloudils.com` needs no Cloudflare change at all — put the same `mailto:` in
its footer and it works.

Only two cases need work:

**A site on a different domain.** Repeat the setup on that zone:

```bash
npx wrangler email routing addresses create you@example.com   # then click the verification mail
npx wrangler email routing enable newdomain.com               # adds the MX, SPF and DKIM records
npx wrangler email routing rules create newdomain.com \
  --name "info forwarding" \
  --match-type literal --match-field to --match-value "info@newdomain.com" \
  --action-type forward --action-value "you@example.com"
```

Check for existing `MX` records on the apex before enabling: `routing enable`
installs Cloudflare's own, and a domain already receiving mail elsewhere will
stop receiving it. `nslookup -type=MX newdomain.com` answers that in a second.

A destination address is account-scoped, so one that is already verified can be
reused by a new zone without another confirmation mail.

**A per-project address**, if you ever want to filter by recipient — add a
second rule (`nextsode@cloudils.com`, say) pointing at the same destination.
Rules are literal matches, so they cost nothing until they exist.

## Changing where the mail lands

Add and verify the new destination, then repoint the rule:

```bash
npx wrangler email routing rules list cloudils.com     # note the rule id
npx wrangler email routing rules update cloudils.com <rule-id> \
  --action-type forward --action-value "new@example.com"
```

The published address does not change, so no deploy is involved.

## In the app

`src/lib/contact.ts` holds the address; the footer and both legal pages import
it. It is one constant because a privacy policy that promises a right to
erasure is only worth the address it gives you — a stale copy in one of the
three is a broken promise, not a typo.
