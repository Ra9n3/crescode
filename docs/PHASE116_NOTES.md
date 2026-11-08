# Phase 11.6 notes

Status: 11.6a and 11.6b are complete.

## Decisions
- Vocalbacking harp velocity allowance: mean absolute delta ≤ 3; maximum absolute delta ≤ 10.
- Piano absorption computes window caps from original velocities, then applies the strictest overlapping cap once per note.
- `golden106` is stale until step 5; do not refresh it before then.

## Next
11.6c, 11.6d, then step 5.
