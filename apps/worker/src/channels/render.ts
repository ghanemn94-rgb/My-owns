// P6 slice C (T-DG6-BE-I; ADR-0054 §3; REQ-S12-023): renders a channel message at send time, in the recipient's locale.
// No message body is stored. The rules:
//  - The message carries the ADR-0051 §3 deep link (`/links/<token>`, re-authorized when opened), never the record.
//  - When the recipient can no longer read the target (`restricted`), the `inbox.restricted` text is used and no
//    `messageParams` value appears anywhere in the message (subject or text).
//  - A notification's own text comes from the catalogue's `messages[messageKey]` template when the catalogue has one
//    (`{{param}}` placeholders; in Arabic `{{param}}` takes `<param>Ar` when it is a non-empty string, the ADR-0025 L1
//    rule of the web's renderMessage). The default catalogue has no per-key templates, so an email names no record
//    value: it says a notification is waiting and links to it. Per-key texts live in the web catalogue
//    (apps/web/src/i18n/*/myWork.json `message`); sharing them with the channels is an open item for the orchestrator.
//  - The subject never contains a parameter value, and CR/LF are removed from it (no header injection).
// Arabic texts are provisional (labelled so in the ADR-0054 catalogues). The worker holds an identical twin
// (apps/worker/src/channels/render.ts); the parity test keeps the two outputs equal.
import type { ChannelLocale, ChannelMessage } from "./port.ts";

export interface ChannelTexts {
  readonly subject: string;
  readonly generic: string;
  readonly restricted: string;
  readonly open: string;
  readonly signIn: string;
  readonly footer: string;
  readonly testSubject: string;
  readonly testLine: string;
  readonly unknown: string;
}

export interface ChannelCatalogue {
  readonly texts: { readonly en: ChannelTexts; readonly ar: ChannelTexts };
  /** Per-messageKey templates by locale (`{{param}}`); absent = the generic line. A Map: never the prototype chain. */
  readonly messages: ReadonlyMap<string, { readonly en: string; readonly ar: string }>;
}

/** The shipped texts (en; ar provisional). `{{product}}` and `{{link}}` are the only placeholders. */
export const DEFAULT_CHANNEL_CATALOGUE: ChannelCatalogue = {
  texts: {
    en: {
      subject: "{{product}}: you have a new notification",
      generic: "You have a new notification in your inbox.",
      restricted: "You no longer have access to this item.",
      open: "Open it in {{product}}: {{link}}",
      signIn: "You will be asked to sign in, and the item opens only if you still have access to it.",
      footer: "This message was sent automatically by {{product}}. Your in-app inbox holds all your notifications.",
      testSubject: "{{product}}: test message",
      testLine: "This is a test message of the email channel. No action is needed.",
      unknown: "Unknown",
    },
    ar: {
      subject: "{{product}}: لديك إشعار جديد",
      generic: "لديك إشعار جديد في صندوق الوارد.",
      restricted: "لم تعد لديك صلاحية الوصول إلى هذا العنصر.",
      open: "افتحه في {{product}}: {{link}}",
      signIn: "سيُطلب منك تسجيل الدخول، ولا يُفتح العنصر إلا إذا كانت لديك صلاحية الوصول إليه.",
      footer: "أُرسلت هذه الرسالة تلقائياً من {{product}}. يحتوي صندوق الوارد داخل التطبيق على جميع إشعاراتك.",
      testSubject: "{{product}}: رسالة اختبار",
      testLine: "هذه رسالة اختبار لقناة البريد الإلكتروني. لا يلزم اتخاذ أي إجراء.",
      unknown: "غير معروف",
    },
  },
  messages: new Map(),
};

/** The product name used when the caller passes none (the configurable product name is the caller's to read). */
export const DEFAULT_CHANNEL_PRODUCT_NAME = "Transformation Hub";

export type ChannelParamValue = string | number | boolean | null;

export interface RenderNotificationInput {
  readonly notificationId: string;
  readonly recipientUserId: string;
  readonly locale: ChannelLocale;
  readonly messageKey: string;
  readonly messageParams: Readonly<Record<string, ChannelParamValue>>;
  /** True when the recipient can no longer read the target (ADR-0051 §3). */
  readonly restricted: boolean;
  readonly deepLinkUrl: string;
  readonly productName?: string;
}

/** Recipient locale: "ar" stays Arabic, anything else is English. */
export function channelLocaleOf(preferred: string | null | undefined): ChannelLocale {
  return preferred === "ar" ? "ar" : "en";
}

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
/** CR, LF and the other C0/C1 controls never reach a header. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

function fill(template: string, values: ReadonlyMap<string, string>): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => values.get(name) ?? whole);
}

const textsOf = (catalogue: ChannelCatalogue, locale: ChannelLocale): ChannelTexts =>
  locale === "ar" ? catalogue.texts.ar : catalogue.texts.en;

function headerSafe(value: string): string {
  return value.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

/** Parameter values for a template, with the Arabic-name rule; null is the locale's Unknown text. */
function paramValues(
  params: Readonly<Record<string, ChannelParamValue>>,
  locale: ChannelLocale,
  unknown: string,
): Map<string, string> {
  const all = new Map(Object.entries(params));
  const out = new Map<string, string>();
  for (const [k, v] of all) {
    if (k.length > 2 && k.endsWith("Ar") && all.has(k.slice(0, -2))) continue;
    const ar = all.get(`${k}Ar`);
    if (locale === "ar" && typeof ar === "string" && ar.trim() !== "") out.set(k, ar);
    else out.set(k, v === null ? unknown : String(v));
  }
  return out;
}

function compose(texts: ChannelTexts, line: string, product: string, link: string): string {
  const base = new Map([
    ["product", product],
    ["link", link],
  ]);
  return [line, "", fill(texts.open, base), fill(texts.signIn, base), "", fill(texts.footer, base)].join("\n");
}

/** Renders one notification for a channel (ADR-0054 §3). */
export function renderNotificationMessage(
  input: RenderNotificationInput,
  catalogue: ChannelCatalogue = DEFAULT_CHANNEL_CATALOGUE,
): ChannelMessage {
  const texts = textsOf(catalogue, input.locale);
  const product = headerSafe(input.productName ?? DEFAULT_CHANNEL_PRODUCT_NAME) || DEFAULT_CHANNEL_PRODUCT_NAME;
  let line: string;
  if (input.restricted) line = texts.restricted;
  else {
    const templates = catalogue.messages.get(input.messageKey);
    const template = templates === undefined ? undefined : input.locale === "ar" ? templates.ar : templates.en;
    line =
      template === undefined
        ? texts.generic
        : fill(template, paramValues(input.messageParams, input.locale, texts.unknown));
  }
  return {
    notificationId: input.notificationId,
    recipientUserId: input.recipientUserId,
    locale: input.locale,
    subject: headerSafe(fill(texts.subject, new Map([["product", product]]))),
    text: compose(texts, line, product, input.deepLinkUrl),
    deepLinkUrl: input.deepLinkUrl,
  };
}

export interface RenderTestInput {
  readonly recipientUserId: string;
  readonly locale: ChannelLocale;
  /** Where the test message points: the application's base URL. */
  readonly linkUrl: string;
  readonly productName?: string;
}

/** The "Send test to me" message of Administration > Notifications (testNotificationChannel). */
export function renderTestMessage(
  input: RenderTestInput,
  catalogue: ChannelCatalogue = DEFAULT_CHANNEL_CATALOGUE,
): ChannelMessage {
  const texts = textsOf(catalogue, input.locale);
  const product = headerSafe(input.productName ?? DEFAULT_CHANNEL_PRODUCT_NAME) || DEFAULT_CHANNEL_PRODUCT_NAME;
  return {
    notificationId: "test",
    recipientUserId: input.recipientUserId,
    locale: input.locale,
    subject: headerSafe(fill(texts.testSubject, new Map([["product", product]]))),
    text: compose(texts, texts.testLine, product, input.linkUrl),
    deepLinkUrl: input.linkUrl,
  };
}
