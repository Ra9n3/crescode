# Post-install verification — 2026-11-14

After the initial Strings implementation was committed/pushed as `6c28fbf`, the user explicitly authorized installing the locked dependencies and starting the development preview.

- `npm ci --no-audit --no-fund`: exit 0; 139 packages installed. No dependency-version or lockfile change.
- Vite launched with `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.e2b.app npm run dev -- --host 0.0.0.0 --port 5173 --strictPort`. A request for `/?strings=v1` using a preview-host header returned HTTP 200.
- Initial `npm run typecheck`: exit 2, three inference/implicit-any diagnostics in the shared assertion helper. Fixed with explicit `string` and `readonly Note[]` annotations; no runtime logic or assertion was removed or weakened.
- Final `npm run typecheck`: exit 0, both application and tests TypeScript configurations passed.
- Final `npm run build`: exit 0; 253 modules transformed; Vite reported 8.06 s.
- `npm test -- tests/strings-orchestration-v1.test.ts tests/strings-identity-v2.test.ts --maxWorkers=1 --minWorkers=1`: initial run 45/45 passed; after the annotation fix, rerun 45/45 passed across two files, 75.31 s. One worker; no timeout.

The full suite and broader adjacent suites were not rerun in this launch step. Earlier missing-tool failures remain historical records, not the current focused/typecheck/build status. Audition archives and Drive uploads are unchanged. This verification does not imply browser interaction, Studio One/sample-library audition or human musical approval.

Use `?strings=v1` on the development server and click Compose All to select the complete new Strings path. Without the query parameter, and in production builds, the existing classic default remains unchanged.
