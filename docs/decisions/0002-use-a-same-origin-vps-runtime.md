# 0002 Use A Same-Origin VPS Runtime

Date: 2026-08-30

## Status

Accepted

## Context

The ordinary browser build needs the authoritative Node/Colyseus server, while
the dedicated ChatGPT Sites build intentionally uses a separate Worker/D1
adapter. A VPS release must preserve both behaviors. Exposing a second browser
endpoint would add mixed-content, CORS, firewall, and configuration failure
modes, and the current VPS already supervises applications with PM2.

## Decision

An ordinary production build uses its page origin for Colyseus unless
`VITE_GAME_SERVER_URL` explicitly overrides it. One Node process serves the
compiled Vite files, Colyseus matchmaking HTTP routes, health checks, and
WebSocket upgrades on that origin.

The default VPS binding is `127.0.0.1:6000`, supervised as one fork-mode PM2
process. A TLS reverse proxy or Cloudflare Tunnel may publish that origin only
after a hostname and access policy are selected. The Sites build continues to
select `HostedNetwork` and does not use this runtime.

## Consequences

- Browser and multiplayer traffic share one URL and TLS boundary.
- Development continues to default to `127.0.0.1:2567`.
- The in-memory Colyseus room model requires one process; horizontal scaling
  needs an explicit shared presence/driver design before it is enabled.
- Restarting the process ends active rooms.
- Public exposure remains a separate access-control and asset-rights decision.

## Validation

- Unit tests lock endpoint and transport selection.
- Integration tests exercise static delivery, health, matchmaking, and a
  two-player WebSocket room on one origin.
- Deployment smoke tests exercise the same boundary through the VPS route.
