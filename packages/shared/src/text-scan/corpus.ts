// The one corpus of the two text rules (ADR-0049 §7; T-DG5-BE-R2, p5-work-split §I.4). The unit test checks the
// TypeScript mirrors against `expected`; the API's integration test runs the SQL functions of 0089 over the same corpus
// and asserts that SQL and TypeScript agree on every entry. It starts with the samples of the architect's probe
// (T01-T04, `docs/delivery/handbacks/DG5/T-DG5-ARCH-06-evidence/probe.ts`) and adds the dialect edge cases (case,
// whitespace kinds, negation words that share a prefix, word boundaries, Arabic-Indic digits). Not exported by the
// package entry: test-only data. Every sample is synthetic.

export interface TextRuleSample {
  readonly text: string | null;
  readonly expected: boolean;
}

/** B0004 and B0124, verbatim from docs/source/playbook.md (true statements; neither is a claim). */
const B0004 =
  "Practical synthesis inspired by PMI Organizational Transformation, Brightline Transformation Compass and PMI Benefits Realization Management; extended with a custom Target Operating Model toolkit.";
const B0124 =
  "This phase aligns with PMI Benefits Realization Management logic: identify expected benefits, deliver/measure them during execution, and sustain benefits after transition to the business.";

export const CLAIM_CORPUS: readonly TextRuleSample[] = [
  // Probe T01: the nine claims (en, ar).
  { text: "This is an official PMI standard.", expected: true },
  { text: "A PMI certified product", expected: true },
  { text: "PMI-certified methodology", expected: true },
  { text: "certified by PMI", expected: true },
  { text: "Officially PMI approved", expected: true },
  { text: "منهجية معتمدة من PMI", expected: true },
  { text: "معيار PMI الرسمي", expected: true },
  { text: "شهادة معهد إدارة المشاريع", expected: true },
  { text: "هذا معيار رسمي من PMI", expected: true },
  // Probe T02: true statements and disclaimers.
  { text: B0004, expected: false },
  { text: B0124, expected: false },
  { text: "Official references", expected: false },
  { text: "Not an official PMI standard.", expected: false },
  {
    text: "Practical synthesis inspired by PMI, Brightline and BRM, with custom extensions. Not an official PMI standard.",
    expected: false,
  },
  { text: "This product is not PMI certified.", expected: false },
  { text: "غير معتمد من PMI", expected: false },
  { text: "ليس معيار PMI الرسمي", expected: false },
  {
    text: "The product operationalizes the Business Transformation Playbook v1.0, a practical synthesis inspired by PMI, Brightline and BRM practice with custom extensions. It is not an official PMI standard, and this product is not certified by PMI or any other body.",
    expected: false,
  },
  {
    text: "يطبّق المنتج دليل تحوّل الأعمال الإصدار 1.0، وهو خلاصة عملية مستوحاة من ممارسات PMI وBrightline وBRM مع إضافات مخصصة. وهو ليس معيارًا رسميًا من PMI، وهذا المنتج غير معتمد من PMI أو من أي جهة أخرى.",
    expected: false,
  },
  { text: "PMI Benefits Realization Management", expected: false },
  { text: "aligns with PMI Benefits Realization Management logic", expected: false },
  { text: "", expected: false },
  { text: null, expected: false },
  // Dialect edge cases (this task).
  { text: "OFFICIAL PMI STANDARD", expected: true },
  { text: "pmi accredited", expected: true },
  { text: "PMI   endorsed", expected: true },
  { text: "official\nPMI", expected: true },
  { text: "official\tan PMI", expected: true },
  { text: "PMI standard software for transformation", expected: true },
  { text: "certified under the PMI rules", expected: true },
  { text: "It is never an official PMI product.", expected: false },
  { text: "Without PMI certification.", expected: false },
  { text: "isn't PMI-approved", expected: false },
  { text: "Nor the official PMI view.", expected: false },
  { text: "No PMI endorsed claim, but certified by PMI.", expected: true },
  { text: "Not an official PMI standard; officially PMI endorsed.", expected: true },
  { text: "رسميًا من معهد إدارة المشاريع", expected: true },
  { text: "PMI المعتمدة", expected: true },
  { text: "دون شهادة PMI", expected: false },
  { text: "لا هو معتمد من PMI", expected: false },
  { text: "PMI inspired, not certified", expected: false },
  { text: "Synthetic demonstration - approves nothing real", expected: false },
  // C ctype (the pinned clusters, ADR-0003): a no-break space is not \s, so these are no claim to either side; the
  // product-text scans also test a copy whose Unicode spaces are made ASCII (apps/api/test/text-scan/scan.ts).
  { text: "official\u00a0PMI", expected: false },
  { text: "PMI\u2003certified", expected: false },
  { text: "Not\u00a0an official PMI standard.", expected: true },
];

export const ENGINEERING_GATE_CORPUS: readonly TextRuleSample[] = [
  // Probe T03 and T04.
  { text: "DG7 approved", expected: true },
  { text: "Release DG 5", expected: true },
  { text: "gate DG-0", expected: true },
  { text: "DG٧", expected: true },
  { text: "(DG3)", expected: true },
  { text: "G6 - Sustain", expected: false },
  { text: "DG8", expected: false },
  { text: "DGX", expected: false },
  { text: "EDG7", expected: false },
  { text: "DG10", expected: false },
  { text: "Product gate G6", expected: false },
  { text: null, expected: false },
  // Dialect edge cases (this task).
  { text: "dg4", expected: true },
  { text: "DG0–DG7", expected: true },
  { text: "gates: DG1, DG2.", expected: true },
  { text: "DG - 6 review", expected: true },
  { text: "x_DG2", expected: false },
  { text: "DG7a", expected: true },
  { text: "DG70", expected: false },
  { text: "DG٧٠", expected: false },
  { text: "DG٨", expected: false },
  { text: "BDG7", expected: false },
  { text: "بوابة DG2", expected: true },
  { text: "DG\u00a07", expected: false },
  { text: "DG\u00a0-7", expected: false },
  { text: "", expected: false },
];
