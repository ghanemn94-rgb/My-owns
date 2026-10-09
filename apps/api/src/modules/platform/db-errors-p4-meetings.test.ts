// Unit tests of the slice D database last lines of BE-F (T-DG4-BE-F; ADR-0032 §11 "Database last-line mappings"):
// forums, participants, meeting series and meetings. Pure: no database. The errors are shaped as node-postgres reports
// the 0044 guards (code, constraint, message); codes and English texts are ADR-0032 §11's (S-11).
import { describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "./db-errors.ts";

const map = (constraint: string, message?: string) =>
  mapDatabaseGuardError({ code: "23514", constraint, ...(message === undefined ? {} : { message }) })!;
const triple = (p: ReturnType<typeof map>) => [p.status, p.code, p.detail];

describe("slice D (BE-F) database guard mapping", () => {
  it("forum and participant lines", () => {
    expect(triple(map("forum_archived_final"))).toEqual([
      422,
      "forum.archived",
      "This forum is archived and can no longer be changed.",
    ]);
    expect(triple(map("forum_publish_outputs_subset"))).toEqual([
      422,
      "forum.publish_output_not_listed",
      "A required publication output must be one of this forum's outputs.",
    ]);
    expect(map("forum_output_kinds_valid").code).toBe("forum.output_kind_invalid");
    expect(map("forum_participant_parties_known").code).toBe("forum.party_unknown");
    for (const c of ["forum_participant_active_user_key", "forum_participant_active_group_key"])
      expect(triple(map(c))).toEqual([
        409,
        "forum_participant.exists",
        "This person or group is already a participant of the forum.",
      ]);
    expect(map("forum_participant_removed_final").code).toBe("forum_participant.removed");
  });

  it("series lines; the rule-version step is a programming error (500), never a version conflict", () => {
    expect(triple(map("meeting_series_one_active_key"))).toEqual([
      409,
      "meeting_series.exists",
      "This forum already has an active meeting series; change it instead.",
    ]);
    expect(triple(map("meeting_series_ended_final"))).toEqual([
      422,
      "meeting_series.ended",
      "This meeting series has ended and can no longer be changed.",
    ]);
    expect(triple(map("meeting_series_rule_shape"))).toEqual([
      400,
      "meeting_series.rule_invalid",
      "A weekly series needs its weekdays, a monthly series a day of the month (1–28), and a daily series neither.",
    ]);
    expect(map("meeting_series_rule_version_step").status).toBe(500);
    expect(map("meeting_series_version_step").status).toBe(409);
  });

  it("meeting lines name the statuses from the guard message", () => {
    expect(
      triple(map("meeting_status_transition", "meeting 0192: scheduled -> held is not a legal transition (ADR-0032)")),
    ).toEqual([422, "meeting.status_transition", "This meeting cannot move from scheduled to held."]);
    expect(triple(map("meeting_final", "meeting 0192: a cancelled meeting is final"))).toEqual([
      422,
      "meeting.final",
      "This meeting is cancelled and can no longer be changed.",
    ]);
    expect(
      triple(
        map("agenda_item_meeting_frozen", "agenda_item: the meeting is minutes_published and its records are frozen"),
      ),
    ).toEqual([422, "meeting.frozen", "This meeting is minutes_published; its records can no longer be changed."]);
  });

  it("writes the API never sends are 500", () => {
    for (const c of [
      "forum_template_immutable",
      "meeting_regenerate_future_only",
      "meeting_created_source",
      "meeting_series_fields",
      "meeting_series_author_required",
      "meeting_minutes_required",
      "meeting_identity_immutable",
    ])
      expect(map(c).status).toBe(500);
  });
});
