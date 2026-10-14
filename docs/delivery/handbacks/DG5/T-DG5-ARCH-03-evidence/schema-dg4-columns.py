# T-DG5-ARCH-03: add the 0075 columns of two DG4 tables (work_item_kind.urgency; inbox_notification delivery state) to
# packages/db/src/schema.ts (interfaces and SCHEMA_COLUMNS). Run once after gen-schema.py, from the repository root.
p = "packages/db/src/schema.ts"
s = open(p).read()
def rep(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:60])
    s = s.replace(a, b)
rep("""  label_ar: string;
  source_ref: string;
}

export interface WorkItemTable extends Stamps {""", """  label_ar: string;
  source_ref: string;
  /** P5 (0075; ADR-0044 §5): 'urgent' kinds are always delivered at once (REQ-S12-025). */
  urgency: Generated<string>;
}

export interface WorkItemTable extends Stamps {""")
rep("""  dedupe_key: string;
  read_at: NullableTimestamp;
}
""", """  dedupe_key: string;
  read_at: NullableTimestamp;
  // P5 (0075; ADR-0044 §5, REQ-S12-025): delivery state; the defaults keep every DG4 row and insert 'delivered'.
  urgency: Generated<string>;
  delivery_state: Generated<string>;
  deliver_after: NullableTimestamp;
  digest_id: string | null;
  is_digest: Generated<boolean>;
}
""")
i = s.index("  inbox_notification: [")
j = s.index("],", i)
s = s[:i] + s[i:j].replace('"read_at",', '"read_at",\n    "urgency",\n    "delivery_state",\n    "deliver_after",\n    "digest_id",\n    "is_digest",') + s[j:]
rep('  work_item_kind: ["code", "owner_module", "label_en", "label_ar", "source_ref"],', '  work_item_kind: ["code", "owner_module", "label_en", "label_ar", "source_ref", "urgency"],')
open(p, "w").write(s)
