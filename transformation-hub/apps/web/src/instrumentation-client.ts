// Runs in the browser before the application's own client code (Next.js client instrumentation): the Zod configuration
// for the strict CSP must be in place before the first schema parse anywhere in the bundle (see lib/zod-csp.ts).
import '@/lib/zod-csp';
