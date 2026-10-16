-- 0088 (P5 slice H; ADR-0048 Consequences; p5-work-split §A rule A-7 and §H.4; T-DG5-KBE-G2). Forward-only.
--
-- Rule A-7 (source inventory): when a P5 feature ships, the source_element rows it implements move from 'planned' to
-- 'working', so the source-coverage report (ADR-0039 §6) stays true for the release (F-DG4-160). The two features of
-- slice H that implement source elements have shipped:
--   - set 'launch_window' (3 rows, B0134): the 90-day launch plan, generated from an adjustable start date, with
--     editable dated tasks, owners and predecessors (T-DG5-BE-P), and the Day-90 leadership test (T-DG5-BE-P2);
--   - set 'health_question' (25 rows, B0150): the 25-question health check, its assessments, score, band, top 3
--     actions and reassessments (T-DG5-KBE-G scoring schemes, T-DG5-KBE-G2 assessments).
-- Nothing else changes: the texts stay verbatim, the identities and ordinals stay, and no row is added or removed. The
-- other planned set, 'roaming_example', moves in 0093 when its dataset ships (p5-work-split §J).
--
-- The form_record_type rows 'launch_plan' and 'health_assessment' (0068) are NOT changed here: they describe a form
-- framework target, which is outside this task's files (see the T-DG5-KBE-G2 handback). Nothing here is a business
-- approval, and nothing touches the engineering gates DG0-DG7.

DO $$
DECLARE
  moved integer;
BEGIN
  UPDATE source_element
     SET feature_status = 'working'
   WHERE set_code IN ('launch_window', 'health_question')
     AND feature_status = 'planned';
  GET DIAGNOSTICS moved = ROW_COUNT;
  IF moved <> 28 THEN
    RAISE EXCEPTION '0088: expected to move the 3 launch windows and 25 health questions (28 rows), moved %', moved;
  END IF;
  IF EXISTS (SELECT 1 FROM source_element WHERE set_code IN ('launch_window', 'health_question') AND feature_status <> 'working') THEN
    RAISE EXCEPTION '0088: a launch window or health question is still planned';
  END IF;
END $$;
