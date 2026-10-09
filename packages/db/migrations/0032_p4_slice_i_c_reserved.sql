-- 0032 — reserved number for slices I and C (p4-work-split §I+C.4), written by the orchestrator (D-090).
--
-- Migration ids must be contiguous (seed.test.ts, p4-work-split S-12). ARCH-01 used 0028–0031 and left 0032 for
-- the slice I/C implementers; ARCH-02 writes 0033+ in parallel with BE-A. To keep the sequence contiguous for both,
-- the orchestrator lands this documented no-op now. Any later schema need of slices I/C takes a number from the
-- orchestrator's repair range 0058–0069.
SELECT 1;
