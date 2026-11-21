# Security Policy

## Reporting a vulnerability

Please report security issues privately — **do not open a public GitHub issue** for a
vulnerability.

| What | Where |
|---|---|
| Security vulnerability in this repository | GitHub **Security Advisories** on `Colabonate/Colabonate` → "Report a vulnerability" |
| Security issue in the protocol specification | GitHub **Security Advisories** on `Colabonate/Colabonate_Protocol` |
| Anything involving live funds, keys or custody | Email `info@colabonate.com` — do not put addresses or keys in a ticket |
| General security question | Public GitHub issue is fine |

Please include: affected file or route, reproduction steps, and the impact you
observed. We aim to acknowledge within 3 working days.

## Scope

In scope: this monorepo (the Colabonate App, the reference server, the MCP server,
the workspace packages, the canister sources) and the protocol specification.

Out of scope: vulnerabilities in third-party dependencies (report those upstream),
and attacks against a user's own wallet or their own Nostr/Lightning node.

## Security model of the platform

These properties are architectural, not incidental. Please read them before reporting
what looks like a bug:

- **No custody.** The buyer pays the seller directly over Lightning. The server never
  holds funds. The platform fee, where one applies, is a separate buyer → Colabonate
  payment for Colabonate-operated infrastructure.
- **Escrow is specified, not live.** The ICP native-Bitcoin escrow canister is
  specified and under construction; it is gated behind a pilot flag. The live payment
  path is Direct-Pay. A report that "escrow is not enforcing X" is about the
  specification, not a vulnerability.
- **Private keys stay client-side.** The server never receives a Nostr private key.
  Key handling in the browser is covered by NIP-07 / NIP-46; encrypted key material at
  rest (NWC connection URIs, LLM provider keys) uses the server-side secretbox.
- **Public by design.** Protocol events are public plaintext Nostr events so that
  third-party arbitrators and indexers can verify them. A report that "order details
  are publicly readable" is a property of the protocol, not a leak — the privacy tier
  model is specified in the protocol repository (`Colabonate/Colabonate_Protocol`).

## Before you report a "leaked secret"

The repository is scanned for committed secrets as part of the normal workflow. If
you find a credential in the working tree, it is almost certainly a placeholder
(`change-me-…`, empty, or a `${VAR}` reference). Real values live only in ignored
`.env*` files and in the deployment environment.

## Hardening notes for operators

If you run this stack:

- Rotate `POSTGRES_PASSWORD`, `JWT_SECRET`, `WIPE_SECRET`, `LNBITS_*` and
  `ALBY_TOKEN_ENCRYPTION_KEY` before exposing any instance. The reference server
  refuses to start with the documented placeholder values.
- Bind Postgres, Redis and Meilisearch to `127.0.0.1` and put a reverse proxy with
  TLS and access control in front of the app.
- Keep the beta access gate enabled on any non-production instance.
