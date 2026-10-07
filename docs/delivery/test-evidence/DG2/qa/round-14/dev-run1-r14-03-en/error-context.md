# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - 'link "Mobily Transformation Hub Provisional Provisional wordmark: no official logo has been supplied. Colours are provisional design tokens, not verified Mobily brand values." [ref=e5] [cursor=pointer]':
      - /url: /login
      - generic [ref=e6]: Mobily Transformation Hub
      - 'generic "Provisional wordmark: no official logo has been supplied. Colours are provisional design tokens, not verified Mobily brand values." [ref=e7]': Provisional
      - generic [ref=e8]: "Provisional wordmark: no official logo has been supplied. Colours are provisional design tokens, not verified Mobily brand values."
    - button "Switch language to العربية" [ref=e10] [cursor=pointer]: العربية
  - main [ref=e11]:
    - region "Sign in" [ref=e12]:
      - heading "Sign in" [level=1] [ref=e13]
      - paragraph [ref=e14]: Sign in with your corporate account to continue.
      - alert [ref=e15]:
        - img [ref=e16]
        - text: Your session ended. Please sign in again.
      - link "Sign in with corporate account" [ref=e18] [cursor=pointer]:
        - /url: /api/v1/auth/login?returnTo=%2Ftransformations
      - paragraph [ref=e19]: You will be redirected to your organization's identity provider.
      - form "Development sign-in" [ref=e20]:
        - heading "Development sign-in" [level=2] [ref=e21]
        - paragraph [ref=e22]:
          - img [ref=e23]
          - text: "Development mode only: signs in a seeded synthetic user. Not available in production."
        - generic [ref=e25]:
          - generic [ref=e26]: Synthetic user name
          - textbox "Synthetic user name" [ref=e27]
        - button "Sign in (development)" [ref=e28] [cursor=pointer]
    - paragraph [ref=e29]: "Branding is provisional: the text wordmark and colours are placeholders, not official Mobily brand assets."
```