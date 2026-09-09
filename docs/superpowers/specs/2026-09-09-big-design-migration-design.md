# Big Design migration — design

**Date:** 2026-09-09
**Branch:** `feat/big-design-migration`
**Status:** Approved (design); implementation plan pending.

## Goal

Refactor the app's styling from its custom Silk-Commerce-branded CSS design system to
BigCommerce's **Big Design** React component library, so the app reads as a native
BigCommerce control-panel app (per the App UI guide:
`https://docs.bigcommerce.com/developer/docs/integrations/apps/guide/ui`).

## Decisions (locked)

1. **Target look:** Native BigCommerce look — adopt Big Design's **stock theme** fully
   (BC blue primary, BC typography/spacing). Drop Silk branding, the Oswald/Raleway
   fonts, and the teal/onyx palette.
2. **Scope:** **Everything** — staff admin (`/staff/*`), public landing (`/`), `/demo`,
   and the embedded `/app-panel/*` views.
3. **Dark mode:** **Dropped.** Big Design is light-only. Remove the theme toggle, the
   `.dark` tokens, and the `silk-apps-theme` bootstrap. App becomes light-only.
4. **Rollout:** One branch (`feat/big-design-migration`), **held out of auto-merge**.
   Commits carry `[skip ship]` so nothing pushes/auto-merges to production; the user
   reviews the finished result and decides when it ships.

## Approach

**Full component migration** (with pragmatic local styled-components for the few widgets
Big Design does not ship).

Standard UI becomes real Big Design components. The ~4 bespoke widgets with no Big Design
equivalent (audit **timeline**, `kv` definition lists, the amber **AI-extraction**
callout, status-**dot** rows) become small local `styled-components` built **from Big
Design theme tokens** — not leftover Silk CSS.

Rejected alternatives:
- **Token reskin** (keep classes, re-point CSS vars): doesn't actually use Big Design
  components, keeps a ~1,500-line stylesheet. Contradicts the ask.
- **Pure hybrid keeping custom CSS for many bits:** more drift, less native.

## Compatibility (verified)

- `@bigcommerce/big-design@5.0.0` peer deps: `react ^19`, `react-dom ^19`,
  `styled-components ^6.1.14`. The app is Next 16 / React 19 → **compatible, no version
  blocker.**
- `@bigcommerce/big-design-theme@3` and `-icons@3` are the matching majors.
- styled-components 6 under the Next App Router needs an **SSR registry**
  (`useServerInsertedHTML`) to avoid FOUC / hydration mismatch.

## Architecture

### Foundation
- **Dependencies:** add `@bigcommerce/big-design`, `@bigcommerce/big-design-theme`,
  `@bigcommerce/big-design-icons`, `styled-components@^6`, and
  `@types/styled-components` (dev) if needed.
- **SSR registry:** `lib/styled-registry.tsx` — a `"use client"` component using
  `ServerStyleSheet` / `useServerInsertedHTML` to inject collected styles during SSR.
- **Root layout (`app/layout.tsx`):** remove `next/font` (Oswald/Raleway) and the
  `THEME_BOOTSTRAP` dark script; wrap the tree in
  `StyledRegistry → ThemeProvider → GlobalStyles → UiProviders`.

### Removing the old system
- Delete Silk-branded `app/globals.css`. Keep only a minimal residual stylesheet for the
  app-shell scaffold and any layout Big Design doesn't cover (as small as possible; prefer
  moving these into styled-components / Big Design layout primitives).
- Remove `components/ui/theme-toggle.tsx`, `.dark` selectors, and the dual Silk logos in
  `shell.tsx`, `page.tsx`, `app-panel/layout.tsx`.

### Component mapping (representative, not exhaustive)

| Current | Big Design |
| --- | --- |
| `.card` / `.card-head` | `Panel` (with `header`) |
| `.btn` / `.btn.primary` / `.btn.ghost` / `.btn.danger` | `Button` (`variant`/`actionType`) |
| `.chip.*` (state/decision) | `Badge` (variant by state) |
| `.stat` tile | `Panel` + `Text`/`H2` |
| `.pa-row` / `SessionRow` / `HealthRow` lists | `Table` / `StatefulTable` or `Flex` rows |
| `.banner` / `.pa-alert` / `.pa-callout` | `Message` / `InlineMessage` |
| form `.field` / `input` / `select` | `Form`, `FormGroup`, `Input`, `Select`, `Textarea` |
| `.switch` toggle | `Switch` |
| range `.range-row` slider | `Slider` (or `Counter` where discrete) |
| `.segmented` / settings tabs `.chip-btn.tab` | `ButtonGroup` / `Tabs` |
| `.pa-stats` / `.pa-2col` grids | `Grid` / `GridItem` / `Flex` |
| toast host (`toast.tsx`) | Big Design alerts/`Message` manager |
| confirm dialog (`confirm.tsx`) | `Modal` |
| headings `h1/h2/h3` | `H1`–`H4`, `Text`, `Small` |
| bespoke: timeline, `kv`, AI-extraction, status dots | local `styled-components` on theme tokens |

### Surfaces / work units
1. **Foundation** — deps, registry, root layout, GlobalStyles/ThemeProvider.
2. **Shell & nav** — `app/staff/shell.tsx`, `app/staff/nav.tsx` (header, responsive
   off-canvas sidebar, status badge, CTA). Drawer behavior preserved.
3. **Shared primitives** — `app/staff/ui.tsx` (PageHead, Stat, Chip, CardHead, HealthRow,
   SessionRow, stateLabel) and `components/ui/states.tsx` (Banner, skeletons, empty
   states). Centralized → most screens update for free.
4. **Providers** — `components/ui/toast.tsx` → Big Design alerts; `components/ui/confirm.tsx`
   → `Modal`. Keep the `useToast()` / `useConfirm()` hook APIs stable so callers are
   untouched.
5. **Interactive forms** — `components/settings-form.tsx` (tabs, switches, sliders,
   segmented, inputs), `components/simulator.tsx`, `components/reply-box.tsx`,
   `components/sessions-browser.tsx`, `components/gmail-connect.tsx`.
6. **Detail screens** — `app/staff/po-inbox/[sessionId]/page.tsx` (+ `actions.tsx`, heaviest),
   `app/staff/po-inbox/page.tsx`, `app/staff/sessions/page.tsx`, `app/staff/usage/page.tsx`,
   `app/staff/settings/page.tsx`, `app/staff/page.tsx` (dashboard).
7. **Public surfaces** — `app/page.tsx` (landing), `app/demo/page.tsx`,
   `app/app-panel/layout.tsx`, `app/app-panel/orders/[id]/page.tsx`,
   `app/app-panel/customers/[id]/page.tsx` (compact iframe framing preserved).

### Isolation / boundaries
- Keep the shared-primitive seam (`ui.tsx`, `states.tsx`, provider hooks). Screens depend
  on those wrappers, not on Big Design directly, wherever a wrapper already exists — so the
  component library is swappable and screens change minimally.
- Bespoke styled-components live next to their consumers (or in `ui.tsx`) and read only
  from the Big Design theme, so there is one source of truth for color/spacing/type.

## Data flow

No data-flow or business-logic changes. This is presentation-only:
`lib/*`, API routes, the store/agent pipeline, and prop/hook contracts are untouched.
Server components stay server components; only client interactivity that already existed
is preserved.

## Error handling

- Preserve every existing state: loading (skeletons → Big Design equivalents), empty
  states, error banners, "backend down" vs "empty" distinction (now `Message` variants),
  unsaved-changes warnings, and test-connection success/failure feedback.
- No new failure modes introduced.

## Testing / verification

- `npm run type-check`, `npm run lint`, `npm test`, `npm run build` must all pass.
- Existing tests are offline logic/unit suites and should be markup-agnostic; any test that
  asserts on removed classes/DOM gets updated to assert on behavior/text instead.
- Run `npm run dev` and visually confirm each surface renders in the BC look with no
  console errors and no hydration warnings.
- Accessibility parity: keep focus-visible rings, `aria-*` on nav/tabs/switches/toasts,
  and reduced-motion behavior (Big Design covers most; verify).

## Out of scope

- No changes to business logic, API routes, `lib/*`, data models, or the agent pipeline.
- No dark theme.
- No unrelated refactors.
- Shipping to production (held until user review).

## Risks

- **styled-components SSR under Next 16 App Router** — mitigated by the registry; verify no
  FOUC/hydration warnings.
- **Big Design has no dark mode** — accepted (dark mode dropped).
- **A few widgets lack Big Design equivalents** — accepted; small theme-token
  styled-components.
- **Bundle size** grows with Big Design + styled-components — acceptable for an internal
  admin app; note it, don't optimize prematurely.
