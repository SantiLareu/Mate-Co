# Admin route /admin + production docs

## Intent and constraints
Official admin entry `/admin` (single AdminLab implementation, /admin-lab kept as dev alias);
localhost works without any auth; production must be published behind Cloudflare Access
(deny-by-default, owner email only, OTP); no client-side fake auth; no backend yet; no commit/push.
Untouched: v3 model, sanitizer, Messi fixture, editor, VTracer, vectorization, production SVG, client library.

## Tasks
- [x] T1: tests/admin-lab.spec.ts route tests added first (RED observed: /admin failed x2, alias passed).
- [x] T2: src/main.tsx — isAdmin = "/admin" || "/admin-lab"; single lazy AdminLab; comments document the contract.
- [x] T3: GREEN 3/3 route tests; AdminLab.tsx header comment updated.
- [x] T4: docs/admin-production.md — authz model, localhost vs production, Access policy checklist
      (deny-by-default, owner email only, One-Time PIN, do not protect whole domain), future /api/admin/*
      behind Access + server-side JWT verification (Cf-Access-Jwt-Assertion), no secrets/email in repo.
- [x] T5: Full verification — focused 3/3; full suite 311/311 passed (0 failed/skipped); typecheck clean;
      build OK (AdminLab code-split 58.30 kB); fixture Messi byte-identical; git log 398f439 unchanged,
      no deletions. No commit/push.

## Evidence
- RED: tests/admin-lab.spec.ts -g entrada → 2 failed (/admin), 1 passed (alias).
- GREEN after main.tsx: 3 passed (3.9s).
