# Manzil Discover

An independent Manzil-branded fork of the complete TREK travel-planning app.
Planning, maps, trips, collaboration, costs, bookings, packing, journals, Studio,
offline support, MCP and the upstream extension system remain together.

This is not an official TREK service. Original copyright, AGPL-3.0 licensing and
third-party notices are preserved. See [the upstream documentation](UPSTREAM_README.md),
[LICENSE](LICENSE), [NOTICE.md](NOTICE.md), and [the Manzil guide](MANZIL.md).

## Manzil changes

- Manzil wordmarks, app icons, loading marks, product text and PWA identity.
- Signup follows the backend's existing public-registration policy.
- A shareable signup URL at `/login?mode=register`.
- Source and license links at `/source.html`.
- A reproducible branded source build using `Dockerfile.manzil`.

The Manzil authentication/storage integration with Supabase is a separate,
unfinished change. Supabase has not been enabled in this fork yet. The existing
native account system and administrator recovery remain in place.

Build from a full checkout:

```sh
docker build -f Dockerfile.manzil -t manzil-discover .
```

The hosting wrapper and persistent Railway service are maintained in
[Manzil-super-app/deploy/discover](https://github.com/gitcwyn25/Manzil-super-app/tree/codex/trek-discover/deploy/discover).
Publishing this source build is still required before these branding changes
appear on the live service.
