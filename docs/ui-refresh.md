# Workspace visual refresh

The product remains a local resume-tailoring workspace. This pass changes presentation, not profile facts, templates, AI prompts, storage, or provider behavior.

## Direction

An action-oriented workspace: warm paper canvas, graphite text, sage navigation and deep-teal primary actions. Keep the existing navigation and flows familiar. No gradients or decorative blur; color indicates selection, action, or meaningful status.

`src/workspace-theme.css` owns the refresh tokens and targeted overrides. `src/styles.css` retains the existing component geometry and responsive foundations. Keeping the theme separate makes this scoped refresh easy to adjust without rewriting the incumbent stylesheet.

- Canvas: `#f5f5ef`
- Surface: `#ffffff`
- Sidebar: `#edf1ea`
- Text: `#202b29`
- Secondary text: `#626e69`
- Primary action: `#16665d`
- Hover action: `#10534b`
- Selection: `#d8e8dc`

On mobile, the resume table prioritises the resume name and View action; linked applications and updated date remain in desktop view. Application tables retain horizontal scrolling to preserve their status controls.

## Online references

- [Linear's UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui): reduce chrome color, strengthen hierarchy, align navigation and use consistent surfaces. Principles only; not a reproduction of Linear's branded UI.
- [Adobe Spectrum color system](https://spectrum.adobe.com/page/color-system/): semantic color roles and deliberate foreground/background contrast.

## Verification

Run `npm test` and `npm run build`. Start the app with isolated data, then run `node scripts/ui-smoke.mjs` (requires `npx playwright install chromium`). The smoke script checks desktop/mobile rendering, teal action color, navigation, tailoring modal, profile, document overflow and browser exceptions. Screenshots go to `UI_OUTPUT_DIR` or the current scratch directory. No paid AI calls are made.
