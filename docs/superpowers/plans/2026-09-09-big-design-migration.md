# Big Design Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's custom Silk-branded CSS design system with BigCommerce Big Design components so every surface reads as a native BigCommerce control-panel app.

**Architecture:** Add Big Design v5 (+ styled-components 6) with a Next App Router SSR registry and a root `ThemeProvider`/`GlobalStyles`. Migrate screen-by-screen, keeping the old `globals.css` in place during the transition so the app stays working after every task; delete it in the final cleanup task. Presentation-only — no business logic, API, `lib/*`, or data-flow changes.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, TypeScript, `@bigcommerce/big-design@5`, `@bigcommerce/big-design-theme@3`, `@bigcommerce/big-design-icons@3`, `styled-components@6`, Vitest (node env, logic-only).

## Global Constraints

- **Every commit message ends with `[skip ship]`** — this branch is held out of the auto-merge pipeline (verified: the post-commit hook prints "[skip ship] present — DevOps pipeline not triggered"). Never push or merge to `main`.
- **Work only on branch `feat/big-design-migration`.** Never commit on `main`.
- **Standard commit trailer** on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Presentation-only.** Do not touch `lib/*`, `app/api/*`, `middleware.ts`, data models, or the agent pipeline. Keep every prop/hook contract (`useToast()`, `useConfirm()`, component prop shapes) stable so consumers are untouched.
- **Big Design peer deps:** `react ^19`, `react-dom ^19`, `styled-components ^6.1.14` — already satisfied by the app.
- **Light theme only.** No dark mode. Remove `.dark` tokens, the theme toggle, and the `silk-apps-theme` bootstrap.
- **Per-task gate (all must stay green):** `npm run type-check`, `npm run lint`, `npm run build`, `npm test`. Plus the visual check named in each task.
- **No new test infrastructure.** Vitest is node-env, logic-only (`tests/**/*.test.ts`). Do not add jsdom/RTL. Unit-test only pure `.ts` logic; verify UI visually via the dev server.
- **Big Design API facts (verified against the installed `.d.ts`):**
  - `Badge` takes `label: string` + `variant?: 'primary'|'secondary'|'success'|'warning'|'danger'` — **label is a string, not children.**
  - `Button` — `variant?: 'primary'|'secondary'|'subtle'|'utility'`, `actionType?: 'normal'|'destructive'`, `iconLeft`, `isLoading`, native button props.
  - `Panel` — `header?: string`, `description?`, `action?: PanelAction`, `badge?: BadgeProps`, `children`.
  - `Message`/`Alert`/`InlineMessage` — `messages: {text: string; link?: {text; href; external?; target?}}[]`, `header?`, `type?: 'success'|'error'|'warning'|'info'`, `actions?`, `onClose?`. **Text-only — cannot hold arbitrary JSX.** Rich banners must use a themed `Box`, not `Message`.
  - Toasts: `createAlertsManager()` → `.add({ type, header?, messages, autoDismiss? })`; render once with `<AlertsManager manager={...} />`.
  - Forms: `Form`, `FormGroup`, `Input` (`label`, `description`, `error`, `type`, native input props), `Select` (`options`, `value`, `onOptionChange`, `label`), `Textarea`, `Checkbox`, `Switch` (native checkbox input: `checked`/`onChange`), `Counter` (`value`, `onCountChange`, `step`, `label`, `description` — **there is no Slider component**).
  - `Tabs` — `items: {id, title}[]`, `activeTab`, `onTabClick`. Titles are plain strings (no embedded dot/icon).
  - `ButtonGroup` — `actions: {text, ...}[]`. Typography: `H0`–`H4`, `Text`, `Small`, `HR`. Layout: `Box`, `Flex`, `Grid`, `GridItem`.
  - `ThemeProvider` is **not** exported by `@bigcommerce/big-design`; import it from `styled-components` and pass `theme` from `@bigcommerce/big-design-theme`. `GlobalStyles` is exported by `@bigcommerce/big-design`.

---

## File Structure

**Created:**
- `lib/styled-registry.tsx` — styled-components SSR registry (client component).
- `lib/ui/badge-variant.ts` — pure `state → Badge variant` + label mapping (unit-tested).
- `tests/ui/badge-variant.test.ts` — unit test for the mapping.
- `components/ui/banner.tsx` — themed banner `Box` (rich-content capable) replacing the `.banner` CSS (may instead live in `states.tsx`; see Task 2).

**Modified (presentation only):**
- `app/layout.tsx`, `next.config.ts`, `app/globals.css` (shrunk, then deleted in Task 11).
- `app/staff/ui.tsx`, `components/ui/states.tsx`, `components/ui/toast.tsx`, `components/ui/confirm.tsx`, `components/ui/providers.tsx`, `components/ui/section.tsx`, `components/ui/money.tsx`, `components/ui/timestamp.tsx`, `components/ui/auto-refresh.tsx`.
- `app/staff/shell.tsx`, `app/staff/nav.tsx`, `app/staff/page.tsx`, `app/staff/po-inbox/page.tsx`, `app/staff/po-inbox/[sessionId]/page.tsx`, `app/staff/po-inbox/[sessionId]/actions.tsx`, `app/staff/sessions/page.tsx`, `app/staff/usage/page.tsx`, `app/staff/settings/page.tsx`.
- `components/settings-form.tsx`, `components/simulator.tsx`, `components/reply-box.tsx`, `components/sessions-browser.tsx`, `components/gmail-connect.tsx`.
- `app/page.tsx`, `app/demo/page.tsx`, `app/app-panel/layout.tsx`, `app/app-panel/orders/[id]/page.tsx`, `app/app-panel/customers/[id]/page.tsx`.

**Deleted (Task 11):** `components/ui/theme-toggle.tsx`, the Silk `app/globals.css` body (replaced by a minimal reset), `public/silk-logo-*.svg` references.

**Component mapping (canonical — applies to every screen task):**

| Old class / element | Big Design target |
| --- | --- |
| `.card`, `.card-head`, `.card.pad` | `Panel` (`header` for the head; `Box` padding is built in) |
| `.btn.primary` / `.btn` / `.btn.ghost` / `.btn.danger` | `Button` `variant="primary"` / `"secondary"` / `"subtle"` / `actionType="destructive"` |
| `.btn.sm` / `.btn.xs` | `Button` (Big Design has one size; drop the modifier) |
| `.chip.<state>` | `Badge` with `label` + `variant` from `lib/ui/badge-variant.ts` |
| `.stat` tile | `Panel` + `Text`/`H1` (see Task 5 snippet) |
| `.pa-row` / `SessionRow` / `HealthRow` lists | `Table` (`columns`/`items`) or `Flex` rows (see Task 2) |
| `.banner` / `.pa-alert` / `.pa-callout` (rich) | themed `Box` via `components/ui/banner.tsx` |
| one-line alert (text + link only) | `Message` |
| form `.field`/`input`/`select`/`textarea` | `Form`/`FormGroup`/`Input`/`Select`/`Textarea` |
| `.switch` | `Switch` |
| `.range-row` slider | `Counter` |
| `.segmented` (2-option) | two `Button`s (selected=primary, other=secondary) |
| settings `.chip-btn.tab` tabs | `Tabs` |
| `.pa-stats` / `.pa-2col` / `.pa-form2` grids | `Grid`/`GridItem` or `Flex` |
| `h1/h2/h3`, `.muted`, `.faint`, `.label` | `H1`–`H4`, `Text color="secondary60"`, `Small` |
| toast host | `AlertsManager` (Task 3) |
| confirm dialog | `Modal` (Task 3) |
| bespoke: `.timeline`, `.kv`, `.card.ai`, `.dot-status`, `pre.block` | local `styled-components` on theme tokens (Task 8) |

---

## Task 1: Foundation — deps, SSR registry, theme provider

**Files:**
- Modify: `package.json` (deps), `next.config.ts`, `app/layout.tsx`
- Create: `lib/styled-registry.tsx`

**Interfaces:**
- Produces: `StyledRegistry` (default-ish export `StyledComponentsRegistry`) wrapping children for SSR; a root tree providing Big Design `ThemeProvider` + `GlobalStyles`. Consumed by every later task implicitly (all Big Design components require GlobalStyles mounted once).

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install @bigcommerce/big-design@^5 @bigcommerce/big-design-theme@^3 @bigcommerce/big-design-icons@^3 styled-components@^6
```
Expected: installs cleanly (peer deps react ^19 satisfied). If npm warns about peers, confirm they are advisory only, not errors.

- [ ] **Step 2: Enable the styled-components SWC transform**

In `next.config.ts`, add a `compiler` key to `nextConfig`:
```ts
const nextConfig: NextConfig = {
  compiler: { styledComponents: true },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn11.bigcommerce.com" },
      { protocol: "https", hostname: "*.bigcommerce.com" },
    ],
  },
};
```

- [ ] **Step 3: Create the SSR registry**

Create `lib/styled-registry.tsx`:
```tsx
"use client";

import { useState, type ReactNode } from "react";
import { useServerInsertedHTML } from "next/navigation";
import { ServerStyleSheet, StyleSheetManager } from "styled-components";

// styled-components 6 under the Next App Router: collect styles during SSR and flush
// them into the streamed HTML so there's no FOUC or hydration mismatch. On the client
// this component is a passthrough.
export function StyledComponentsRegistry({ children }: { children: ReactNode }) {
  const [sheet] = useState(() => new ServerStyleSheet());

  useServerInsertedHTML(() => {
    const styles = sheet.getStyleElement();
    sheet.instance.clearTag();
    return <>{styles}</>;
  });

  if (typeof window !== "undefined") return <>{children}</>;

  return <StyleSheetManager sheet={sheet.instance}>{children}</StyleSheetManager>;
}
```

- [ ] **Step 4: Wire the root layout**

Rewrite `app/layout.tsx` (remove Oswald/Raleway `next/font` and the `THEME_BOOTSTRAP` dark script; keep `./globals.css` import for now):
```tsx
import type { ReactNode } from "react";
import { GlobalStyles } from "@bigcommerce/big-design";
import { theme } from "@bigcommerce/big-design-theme";
import { ThemeProvider } from "styled-components";
import "./globals.css";
import { StyledComponentsRegistry } from "@/lib/styled-registry";
import { UiProviders } from "@/components/ui/providers";

export const metadata = {
  title: "PO Agent",
  description: "Email-first purchase-order processing for BigCommerce B2B Edition.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <StyledComponentsRegistry>
          <ThemeProvider theme={theme}>
            <GlobalStyles />
            <UiProviders>{children}</UiProviders>
          </ThemeProvider>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Verify build + SSR (no hydration warnings)**

Run: `npm run type-check && npm run build`
Expected: PASS. Then `npm run dev`, open `http://localhost:3000/`, open the browser console.
Expected: page renders; **no** hydration-mismatch warning and **no** FOUC on hard reload. (Screens still use old classes — that's fine; `globals.css` is still loaded. Big Design's font/reset now also apply.)

- [ ] **Step 6: Commit**
```bash
git add package.json package-lock.json next.config.ts lib/styled-registry.tsx app/layout.tsx
git commit -m "feat(ui): add Big Design + styled-components SSR foundation [skip ship]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Shared primitives → Big Design

**Files:**
- Create: `lib/ui/badge-variant.ts`, `tests/ui/badge-variant.test.ts`
- Modify: `app/staff/ui.tsx`, `components/ui/states.tsx`
- Create: `components/ui/banner.tsx`

**Interfaces:**
- Consumes: Big Design `Panel`, `Badge`, `Flex`, `Box`, `Text`, `H1`, `Table` (Task 1 foundation).
- Produces (signatures unchanged from today so callers don't change):
  - `PageHead({ title, sub?, children? })`, `Stat({ label, value, note?, tone?, compact?, hint? })`, `Chip({ kind?, size?, children? })`, `CardHead({ title, sm?, children? })`, `HealthRow({ ok, warn?, name, detail?, action? })`, `SessionRow({ href, company, sub?, meta?, state?, stateLabel?, tint? })`, `STATE_LABEL`, `stateLabel(state?)`.
  - `Banner({ kind, title?, children })` where `kind: "info"|"warn"|"error"|"ok"`.
  - `badgeVariant(state: string): 'primary'|'secondary'|'success'|'warning'|'danger'` from `lib/ui/badge-variant.ts`.

- [ ] **Step 1: Write the failing test for the state→variant map**

Create `tests/ui/badge-variant.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { badgeVariant } from "@/lib/ui/badge-variant";

describe("badgeVariant", () => {
  it("maps completed states to success", () => {
    expect(badgeVariant("completed_order")).toBe("success");
    expect(badgeVariant("completed_quote")).toBe("success");
  });
  it("maps failure states to danger", () => {
    expect(badgeVariant("escalated")).toBe("danger");
    expect(badgeVariant("rejected")).toBe("danger");
  });
  it("maps waiting states to warning", () => {
    expect(badgeVariant("clarifying")).toBe("warning");
    expect(badgeVariant("awaiting_confirmation")).toBe("warning");
  });
  it("maps in-flight states to primary", () => {
    expect(badgeVariant("new")).toBe("primary");
    expect(badgeVariant("identifying")).toBe("primary");
    expect(badgeVariant("validating")).toBe("primary");
    expect(badgeVariant("submitting")).toBe("primary");
  });
  it("falls back to secondary for expired/unknown", () => {
    expect(badgeVariant("expired")).toBe("secondary");
    expect(badgeVariant("something-else")).toBe("secondary");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/ui/badge-variant.test.ts`
Expected: FAIL — cannot resolve `@/lib/ui/badge-variant`.

- [ ] **Step 3: Implement the pure mapping**

Create `lib/ui/badge-variant.ts`:
```ts
// Pure state → Big Design Badge variant map. Kept React-free so it unit-tests under the
// node-env vitest suite. Consumed by app/staff/ui.tsx <Chip>.
export type BadgeVariant = "primary" | "secondary" | "success" | "warning" | "danger";

const VARIANT: Record<string, BadgeVariant> = {
  completed_order: "success",
  completed_quote: "success",
  order: "success",
  quote: "success",
  escalated: "danger",
  rejected: "danger",
  reject: "danger",
  escalate: "danger",
  clarifying: "warning",
  clarify: "warning",
  awaiting_confirmation: "warning",
  new: "primary",
  identifying: "primary",
  validating: "primary",
  submitting: "primary",
  expired: "secondary",
  neutral: "secondary",
};

export function badgeVariant(state: string): BadgeVariant {
  return VARIANT[state] ?? "secondary";
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/ui/badge-variant.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `app/staff/ui.tsx` on Big Design**

Replace each primitive. Keep exported signatures identical. Reference implementations:
```tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { Badge, Box, Flex, FlexItem, H1, Panel, Text } from "@bigcommerce/big-design";
import { badgeVariant } from "@/lib/ui/badge-variant";

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" marginBottom="medium">
      <Box>
        <H1>{title}</H1>
        {sub ? <Text color="secondary60" marginTop="xxSmall">{sub}</Text> : null}
      </Box>
      {children ? <Flex alignItems="center">{children}</Flex> : null}
    </Flex>
  );
}

export function Stat({ label, value, note, tone, hint }: {
  label: string; value: ReactNode; note?: ReactNode; tone?: "ok" | "bad"; compact?: boolean; hint?: string;
}) {
  const color = tone === "bad" ? "danger" : tone === "ok" ? "success" : "secondary70";
  return (
    <Panel title={hint}>
      <Text color="secondary60" bold marginBottom="xxSmall">{label}</Text>
      <Text as="div" color={color} style={{ fontSize: 28, fontWeight: 600, lineHeight: 1 }}>{value}</Text>
      {note ? <Text color="secondary60" marginTop="xxSmall">{note}</Text> : null}
    </Panel>
  );
}

export function Chip({ kind, children }: { kind?: string; size?: "lg" | "sm"; children?: ReactNode }) {
  const label = typeof children === "string" ? children : (kind ?? "—");
  return <Badge label={label} variant={badgeVariant(kind ?? "neutral")} />;
}
```
Notes for the remaining primitives in this file:
- `CardHead` — no longer needed as a standalone element (Big Design `Panel` takes a `header` string). Keep the export as a passthrough that renders a `Text bold` so existing call sites keep compiling, OR update call sites in later screen tasks to use `Panel header=`. Keep it as: `export function CardHead({ title }: {...}) { return <Text bold marginBottom="small">{title}</Text>; }` for now.
- `HealthRow` — render a `Flex` row: a status dot (`<Box>` circle via inline style using theme is fine, or a `Badge`), the `name` as `Text`, `detail` as `Text color="secondary60"`, and when `!ok && action`, a `Button variant="subtle"` wrapped in `<Link>`.
- `SessionRow` — render `<Link>` wrapping a `Flex` row (company as `Text bold`, `sub` as `Small`, `meta` as `Small`, and `<Chip kind={state}>{stateLabel}</Chip>`). Tint (`bad`/`warn`) → subtle background via `Box backgroundColor`.
- Keep `STATE_LABEL` and `stateLabel()` exactly as they are.

- [ ] **Step 6: Create the themed `Banner`**

Create `components/ui/banner.tsx` (rich content — Big Design `Message` can't hold JSX):
```tsx
import type { ReactNode } from "react";
import { Box, Flex, Text } from "@bigcommerce/big-design";

const TONE: Record<string, { border: string; bg: string }> = {
  info:  { border: "primary40",   bg: "primary10" },
  warn:  { border: "warning40",   bg: "warning10" },
  error: { border: "danger40",    bg: "danger10" },
  ok:    { border: "success40",   bg: "success10" },
};

// A left-ruled callout that can hold arbitrary JSX (bold, code, lists, links) — Big
// Design's Message component only accepts plain-text messages, so rich banners use this
// themed Box instead. Colors come from the Big Design theme's color scale.
export function Banner({ kind, title, children }: {
  kind: "info" | "warn" | "error" | "ok"; title?: ReactNode; children: ReactNode;
}) {
  const tone = TONE[kind] ?? TONE.info;
  return (
    <Box
      backgroundColor={tone.bg as never}
      border="box"
      borderRadius="normal"
      padding="medium"
      style={{ borderLeftWidth: 4 }}
    >
      {title ? <Text bold marginBottom="xSmall">{title}</Text> : null}
      <Flex flexDirection="column">{children}</Flex>
    </Box>
  );
}
```
Then in `components/ui/states.tsx`, re-export/replace the existing `Banner` with this one (keep the `kind`/`title`/`children` signature the same so callers are untouched), and migrate the skeleton and empty-state helpers to Big Design (`ProgressCircle` or simple themed `Box` for skeletons; a `Flex` column with `Text` for empty states). Confirm the exact current exports of `states.tsx` and preserve each.

> If any theme color token name (`primary10`, `warning40`, …) does not exist on `theme.colors`, open `node_modules/@bigcommerce/big-design-theme/dist/index.d.ts` and pick the nearest existing scale value. Do not invent tokens.

- [ ] **Step 7: Verify**

Run: `npm run type-check && npm run lint && npx vitest run && npm run build`
Expected: all PASS. Then `npm run dev`, open `/staff` and `/staff/sessions`: stat tiles, badges, session rows, and any banners render in the BC look. No console errors.

- [ ] **Step 8: Commit**
```bash
git add lib/ui/badge-variant.ts tests/ui/badge-variant.test.ts app/staff/ui.tsx components/ui/banner.tsx components/ui/states.tsx
git commit -m "feat(ui): migrate shared primitives to Big Design [skip ship]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Providers — toasts and confirm dialog

**Files:**
- Modify: `components/ui/toast.tsx`, `components/ui/confirm.tsx`, `components/ui/providers.tsx`

**Interfaces:**
- Consumes: `createAlertsManager`, `AlertsManager`, `Modal` from `@bigcommerce/big-design`.
- Produces (unchanged public API): `useToast(): { show, success, error, info }`, `ToastProvider`, `useConfirm()` / `ConfirmProvider` (whatever `confirm.tsx` exports today — preserve exactly). `UiProviders` still wraps both.

- [ ] **Step 1: Rewrite `toast.tsx` on the alerts manager**

Keep the `useToast()` API identical; back it with Big Design alerts. Reference:
```tsx
"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { AlertsManager, createAlertsManager } from "@bigcommerce/big-design";

type ToastKind = "ok" | "error" | "info";
interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}
const TYPE: Record<ToastKind, "success" | "error" | "info"> = { ok: "success", error: "error", info: "info" };
const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(() => createAlertsManager());
  const api = useMemo<ToastApi>(() => {
    const show = (message: string, kind: ToastKind = "info") =>
      manager.add({ type: TYPE[kind], messages: [{ text: message }], autoDismiss: true });
    return { show, success: (m) => show(m, "ok"), error: (m) => show(m, "error"), info: (m) => show(m, "info") };
  }, [manager]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <AlertsManager manager={manager} />
    </ToastCtx.Provider>
  );
}
```

- [ ] **Step 2: Rewrite `confirm.tsx` on `Modal`**

Read the current `components/ui/confirm.tsx` to capture its exact exported hook/provider API and the shape of the confirm options (title/body/danger/confirmLabel etc.). Re-implement the dialog with Big Design `Modal` (`isOpen`, `onClose`, `header`, `actions: [{ text, variant/actionType, onClick }]`), preserving the exported names, the returned `confirm(...)` promise semantics, and the danger styling (map danger → `actionType="destructive"` on the confirm action). Do not change call sites.

- [ ] **Step 3: Verify `providers.tsx` still composes both**

`UiProviders` stays `ToastProvider > ConfirmProvider > children`. No change unless the confirm export names changed (they must not).

- [ ] **Step 4: Verify**

Run: `npm run type-check && npm run lint && npm run build`
Expected: PASS. Then `npm run dev`: on `/staff/settings` click **Save** (triggers a toast) and confirm it appears as a Big Design alert that auto-dismisses; trigger a destructive confirm (e.g. a reprocess/reject action in the inbox) and confirm the Big Design Modal appears with a destructive confirm button.

- [ ] **Step 5: Commit**
```bash
git add components/ui/toast.tsx components/ui/confirm.tsx components/ui/providers.tsx
git commit -m "feat(ui): back toasts with Big Design alerts, confirm with Modal [skip ship]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: App shell & nav

**Files:**
- Modify: `app/staff/shell.tsx`, `app/staff/nav.tsx`

**Interfaces:**
- Consumes: `Badge`, `Box`, `Button`, `Flex`, `Text` from Big Design; `useToast`/routing unchanged.
- Produces (unchanged): `AppShell({ escalated, status, children })`, `ShellStatus`, `AdminNav({ escalated?, onNavigate? })`.

- [ ] **Step 1: Rebuild the header in `shell.tsx`**

Preserve the responsive behavior (static sidebar ≥960px; off-canvas drawer + scrim below, burger toggles `menuOpen`, closes on route change + Escape). Replace markup:
- Remove the two Silk `<img>` logos and the `ThemeToggle`. Replace the wordmark with `<Text bold>PO Agent</Text>` (optionally a Big Design icon).
- Status: `<Badge label={status.label} variant={status.tone === "ok" ? "success" : status.tone === "warn" ? "warning" : "danger"} />`.
- Header CTA: `<Button variant="primary"><Link href="/staff/simulator">Try the simulator</Link></Button>` (or a Big Design `Link`-styled button).
- Header/sidebar chrome: `Box` with `theme.colors.secondary20` borders / `white` surface. The top gradient rule (`.app-gradient`) is dropped (Silk brand) unless it renders acceptably on theme tokens; default = drop it.

- [ ] **Step 2: Rebuild `nav.tsx`**

Keep the `GROUPS` data and `isActive` logic. Render each group label as `<Small bold color="secondary50">`, each item as a `<Link>` styled with a themed `Box` (active = `primary10` background + `primary` left border + `primary` text; hover = `secondary10`). The escalated badge → `<Badge label={String(badge)} variant="danger" />`. Sign-out stays a plain `<a href="/api/staff/signout">`.

> The drawer/scrim/burger positioning has no Big Design equivalent; implement it with a small local `styled-components` block (or scoped inline styles) reading theme tokens. This replaces the `.pa-nav`, `.pa-scrim`, `.pa-burger` CSS.

- [ ] **Step 3: Verify**

Run: `npm run type-check && npm run lint && npm run build`
Expected: PASS. Then `npm run dev`, open `/staff`: header shows the status badge + CTA (no logo, no theme toggle); sidebar highlights the active section; the escalated badge shows on Inbox when there are escalations. Resize below 960px: burger opens the drawer over a scrim; selecting an item or pressing Escape closes it.

- [ ] **Step 4: Commit**
```bash
git add app/staff/shell.tsx app/staff/nav.tsx
git commit -m "feat(ui): rebuild admin shell and nav on Big Design [skip ship]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Dashboard

**Files:**
- Modify: `app/staff/page.tsx`

**Interfaces:**
- Consumes: `PageHead`, `Stat`, `Chip`, `SessionRow`, `HealthRow`, `stateLabel` (Task 2); `Banner` (Task 2); `Grid`, `GridItem`, `Panel`, `Button`, `Box`, `Text` from Big Design.

- [ ] **Step 1: Migrate layout containers**

Replace `.pa-stats` with a Big Design responsive `Grid`:
```tsx
<Grid gridColumns={{ mobile: "repeat(2, 1fr)", tablet: "repeat(3, 1fr)", desktop: "repeat(6, 1fr)" }} marginBottom="large">
  <Stat label="Received" value={metrics.received} note="POs this month" hint="POs received this calendar month" />
  {/* …the other five Stat tiles unchanged in props… */}
</Grid>
```
Replace `.pa-2col` with `<Grid gridColumns={{ mobile: "1fr", desktop: "1.2fr 1fr" }} gridGap="16px">`.

- [ ] **Step 2: Migrate the two info banners and the escalation call-out**

The Redis banner and first-run banner keep their rich JSX children — pass them to the Task 2 `<Banner kind="warn" | "info" title=…>`. The `.pa-alert` escalation call-out becomes a clickable themed `Box` (danger left rule) wrapping a `<Link href={INBOX}>` with the title/detail `Text` and a right-arrow — or a `<Message type="error" header=… messages=[{text: …}] />` if the copy can be reduced to text. Prefer the themed `Box` to keep the two-line copy + arrow.

- [ ] **Step 3: Migrate the two Panels**

"Recent sessions" and "Setup & health" become `<Panel header="Recent sessions">` / `<Panel header="Setup & health">` containing the `SessionRow` / `HealthRow` lists (already migrated in Task 2). The card foot "All sessions →" link becomes `<Button variant="subtle"><Link href="/staff/sessions">All sessions →</Link></Button>`. The empty state uses the Task 2 empty-state helper.

- [ ] **Step 4: Verify**

Run: `npm run type-check && npm run lint && npm run build`
Expected: PASS. Then `npm run dev`, open `/staff`: six stat tiles in a responsive grid, both panels, banners, and (if any escalations) the call-out all render natively. No console errors.

- [ ] **Step 5: Commit**
```bash
git add app/staff/page.tsx
git commit -m "feat(ui): migrate dashboard to Big Design [skip ship]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Settings form + settings page

**Files:**
- Modify: `components/settings-form.tsx`, `app/staff/settings/page.tsx`

**Interfaces:**
- Consumes: `Tabs`, `Panel`, `Form`, `FormGroup`, `Input`, `Select`, `Switch`, `Counter`, `Button`, `Badge`, `Text`, `Flex`, `Box` from Big Design; `useToast` (Task 3).
- Produces: unchanged `SettingsForm` prop shape (`fields`, `view`, `defaults`, `health`, `origin`, `installs`).

- [ ] **Step 1: Replace the tab strip with `Tabs`**

```tsx
<Tabs
  activeTab={tab}
  onTabClick={(id) => setTab(id as TabId)}
  items={TABS.map((t) => ({ id: t.id, title: t.label }))}
/>
```
Per-tab health dot moves off the tab (Big Design tab titles are plain strings). Instead, at the top of each panel render a health `Badge`: `<Badge label={health[tab] ? "configured" : "incomplete"} variant={health[tab] ? "success" : "warning"} />`. Keep `active.sub` as a `<Text color="secondary60">` under the tabs.

- [ ] **Step 2: Replace the field controls**

- `SettingField` → `Input` (`label`, `type`, `value`, `onChange`, `placeholder`, `description={def.help}`) or `Select` (`label`, `options`, `value`, `onOptionChange`). The 🔒 secret hint → append to the `label` or use `Input` `description`.
- `SettingToggle` → `Switch` (`checked={on}`, `onChange={onToggle}`) with an adjacent `<Box>`/`<Flex>` holding the label `Text bold` + help `Small`.
- `SettingSlider` → `Counter` (`label={def.label}`, `value`, `step={1}`, `onCountChange={(n) => onChange(String(n))}`, `description={note}`). Min/max: clamp in the `onCountChange` handler (Counter has no min/max prop — enforce `Math.min(max, Math.max(min, n))`).

- [ ] **Step 3: Replace the segmented control (channel) and the save bar**

Channel Gmail/Microsoft segmented → two `Button`s: selected = `variant="primary"`, other = `variant="secondary"`, inside a `<Flex>`. Save bar: `Button variant="primary"` (Save, `isLoading={saving}`), `Button variant="secondary"` (Test, `isLoading={testing}`), and the test result / unsaved-changes text as `Text color={ok ? "success" : "danger"}` / a `warning` `Badge`.

- [ ] **Step 4: Wrap each tab's body in a `Panel`**

Each `tab === …` block's outer `.card.pad` → `<Panel>`. Grids (`.pa-form2`) → `<Grid gridColumns={{ mobile: "1fr", tablet: "1fr 1fr" }} gridGap="16px">`. The "Installed stores" list → a small `Table` or `Flex` rows with a `Badge label="OAuth (per-store)" variant="secondary"`.

- [ ] **Step 5: Check `settings/page.tsx`**

Update its wrapper markup (PageHead already migrated). Ensure no leftover `.card`/`.pa-*` classes remain.

- [ ] **Step 6: Verify**

Run: `npm run type-check && npm run lint && npm run build`
Expected: PASS. Then `npm run dev`, open `/staff/settings`: tabs switch; toggles, counters, inputs, selects, and the channel buttons all work; Save shows a toast; unsaved-changes indicator and test-connection feedback render.

- [ ] **Step 7: Commit**
```bash
git add components/settings-form.tsx app/staff/settings/page.tsx
git commit -m "feat(ui): migrate settings form to Big Design [skip ship]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Simulator, reply box, gmail connect

**Files:**
- Modify: `components/simulator.tsx`, `components/reply-box.tsx`, `components/gmail-connect.tsx`

**Interfaces:**
- Consumes: `Panel`, `Form`, `Input`, `Textarea`, `Button`, `Badge`, `Box`, `Flex`, `Text` from Big Design; `useToast`.

- [ ] **Step 1: Migrate `simulator.tsx`**

Convert its cards → `Panel`, buttons → `Button`, inputs/textarea → `Input`/`Textarea`, chips/status → `Badge`, layout → `Flex`/`Grid`, `pre.block` output → a themed `styled-components` `<pre>` reading `theme.colors.secondary70` background (bespoke; keep monospace + wrap). Preserve all client logic and prop shapes.

- [ ] **Step 2: Migrate `reply-box.tsx`**

Textarea → `Textarea`, send/cancel → `Button` (`variant="primary"`/`"subtle"`), any template chips → `Button variant="subtle"` or `Badge`. Preserve behavior.

- [ ] **Step 3: Migrate `gmail-connect.tsx`**

Connect button → `Button`, status text → `Text`/`Badge`. Preserve OAuth flow.

- [ ] **Step 4: Verify**

Run: `npm run type-check && npm run lint && npm run build`
Expected: PASS. Then `npm run dev`, open `/staff/simulator` and run a simulated PO end-to-end; open a session in `/staff/po-inbox` and open the reply box. Both render natively and function.

- [ ] **Step 5: Commit**
```bash
git add components/simulator.tsx components/reply-box.tsx components/gmail-connect.tsx
git commit -m "feat(ui): migrate simulator, reply box, gmail connect to Big Design [skip ship]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: PO inbox list + detail + actions (+ bespoke widgets)

**Files:**
- Modify: `app/staff/po-inbox/page.tsx`, `app/staff/po-inbox/[sessionId]/page.tsx`, `app/staff/po-inbox/[sessionId]/actions.tsx`
- Create: `components/ui/detail-widgets.tsx` (bespoke: `Timeline`, `KeyValue`, `AiCard`, `Callout`, `StatusDot`)

**Interfaces:**
- Consumes: Task 2 primitives, `Panel`, `Badge`, `Button`, `Flex`, `Grid`, `Text`, `Small` from Big Design.
- Produces: `Timeline`, `KeyValue`, `AiCard`, `Callout`, `StatusDot` — small styled-components built from theme tokens, reused across detail screens.

- [ ] **Step 1: Build the bespoke widgets**

Create `components/ui/detail-widgets.tsx` with `styled-components` that read only from the Big Design theme (`props.theme.colors.*`, `.spacing.*`, `.typography.*`). Port the visuals of `.timeline`, `.kv`, `.card.ai`/`.ai-tag`/`.kv-lines`, `.pa-callout.{bad,warn,ok,info}`, and `.dot-status.{ok,bad,warn,sage,sky}` from the current `globals.css` (Task 11 will delete the originals). Keep the same DOM structure/props the detail page needs.

- [ ] **Step 2: Migrate the inbox list `po-inbox/page.tsx`**

Filters/tabs → `Tabs` or `Button` group; the queue list → `SessionRow`s (Task 2) inside a `Panel`; empty state → Task 2 helper.

- [ ] **Step 3: Migrate the detail `[sessionId]/page.tsx` (heaviest, 75 classNames)**

Work section by section using the canonical mapping table. Every distinct pattern present and its target:
- `.card`/`.card-head`/`.card-body`/`.card-foot` → `Panel` (`header`) / `Box`.
- `.card.ai` block → `<AiCard>` (bespoke).
- `.kv` / `.kv-lines` → `<KeyValue>` (bespoke).
- `.timeline .ev` audit trail → `<Timeline>` (bespoke).
- `.pa-callout.*` escalation reason → `<Callout tone=…>` (bespoke).
- `.chip.*` → `<Chip>` (Task 2).
- `.pa-row` / `.kv` line items → `Flex` rows / `<KeyValue>`.
- `.btn*` → `Button`.
- `.banner*` → `<Banner>` (Task 2).
- `.pa-2col`/`.pa-col`/`.stack` → `Grid`/`Flex`.
- `.dot-status` → `<StatusDot tone=…>`.
- headings/`.muted`/`.faint`/`.num` → `H2`–`H4`/`Text`/`Small`.

- [ ] **Step 4: Migrate `actions.tsx`**

Action buttons (approve/reject/reprocess/escalate) → `Button` with the right `variant`/`actionType` (destructive for reject); confirmations already route through the Task 3 `Modal`. Preserve every handler.

- [ ] **Step 5: Verify**

Run: `npm run type-check && npm run lint && npm run build`
Expected: PASS. Then `npm run dev`, open `/staff/po-inbox` and a session detail: AI-extraction card, key-value blocks, timeline, callouts, chips, and action buttons all render natively; actions still fire (with the Modal confirm where applicable).

- [ ] **Step 6: Commit**
```bash
git add app/staff/po-inbox/page.tsx "app/staff/po-inbox/[sessionId]/page.tsx" "app/staff/po-inbox/[sessionId]/actions.tsx" components/ui/detail-widgets.tsx
git commit -m "feat(ui): migrate PO inbox list and detail to Big Design [skip ship]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Sessions, usage, sessions-browser

**Files:**
- Modify: `app/staff/sessions/page.tsx`, `app/staff/usage/page.tsx`, `components/sessions-browser.tsx`

**Interfaces:**
- Consumes: Task 2 primitives, `Table`/`StatefulTable`, `Panel`, `Input`/`Search`, `Badge`, `Flex`, `Grid` from Big Design.

- [ ] **Step 1: Migrate `sessions-browser.tsx`**

Search box → Big Design `Input`/`Search`; filter chips → `Button variant="subtle"` toggles or `Badge`; the results list → `SessionRow`s in a `Panel`, or a `Table` (`columns`/`items`) if a tabular layout reads better. Preserve the search/filter client logic and prop shape.

- [ ] **Step 2: Migrate `sessions/page.tsx` and `usage/page.tsx`**

Containers → `Panel`/`Grid`; stat/delta tiles on the usage page → `Stat` (Task 2) + a bespoke `<Delta>` (small styled span, up=danger/down=success) if the `.delta` visual is needed; month chips → `Button variant="subtle"` toggles.

- [ ] **Step 3: Verify**

Run: `npm run type-check && npm run lint && npm run build`
Expected: PASS. Then `npm run dev`, open `/staff/sessions` (search + filter) and `/staff/usage` (tiles + deltas). Both render natively and function.

- [ ] **Step 4: Commit**
```bash
git add app/staff/sessions/page.tsx app/staff/usage/page.tsx components/sessions-browser.tsx
git commit -m "feat(ui): migrate sessions and usage screens to Big Design [skip ship]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Public surfaces — landing, demo, app-panel

**Files:**
- Modify: `app/page.tsx`, `app/demo/page.tsx`, `app/app-panel/layout.tsx`, `app/app-panel/orders/[id]/page.tsx`, `app/app-panel/customers/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 2 primitives + Big Design layout/typography/`Panel`/`Button`.

- [ ] **Step 1: Migrate the landing `app/page.tsx`**

Remove the `.public-bar` gradient, the two Silk logos, the `ThemeToggle`, and the `.app-divider`. Header → a `Box`/`Flex` with `<Text bold>PO Agent</Text>`. The two cards ("Admin console", "Public demo") → `Panel`s with `H3`/`Text`/`Button`+`Link`. Wrap content in a centered `Box maxWidth`.

- [ ] **Step 2: Migrate `demo/page.tsx`**

Same header treatment; the demo pipeline UI → `Panel`/`Button`/`Textarea`/`Badge`. Preserve the client demo logic.

- [ ] **Step 3: Migrate `app-panel/*` (compact iframe framing)**

`app-panel/layout.tsx` — remove the gradient + Silk logos; keep the compact slim header as a themed `Box` with `<Text bold>PO Agent</Text>` and the `maxWidth: 560` content wrapper (this framing is intentional for the control-panel iframe). `orders/[id]/page.tsx` and `customers/[id]/page.tsx` → `Panel`/`KeyValue`/`Badge`.

- [ ] **Step 4: Verify**

Run: `npm run type-check && npm run lint && npm run build`
Expected: PASS. Then `npm run dev`, open `/`, `/demo`, and an `/app-panel/...` route: all render natively, no Silk logos/gradient/theme toggle, no console errors.

- [ ] **Step 5: Commit**
```bash
git add app/page.tsx app/demo/page.tsx app/app-panel/layout.tsx "app/app-panel/orders/[id]/page.tsx" "app/app-panel/customers/[id]/page.tsx"
git commit -m "feat(ui): migrate public landing, demo, app-panel to Big Design [skip ship]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Cleanup — delete the old system

**Files:**
- Delete: `components/ui/theme-toggle.tsx`
- Modify/replace: `app/globals.css` (strip to a minimal reset), remove Silk logo assets references
- Sweep: all view files for stray old classes

- [ ] **Step 1: Confirm nothing imports the theme toggle or old classes**

Run:
```bash
grep -rn "theme-toggle\|ThemeToggle" app components
grep -rn "silk-logo\|silk-apps-theme\|font-oswald\|font-raleway" app components
grep -rEn "className=\"[^\"]*\b(card|btn|chip|pa-|stat|banner|toast|switch|segmented|nav-item|kv|timeline|dot-status)\b" app components
```
Expected: no matches (except intentional bespoke class names you kept). Fix any stragglers by migrating them per the mapping table.

- [ ] **Step 2: Delete the theme toggle**

Run: `git rm components/ui/theme-toggle.tsx`

- [ ] **Step 3: Reduce `globals.css` to a minimal reset**

Replace the entire Silk stylesheet with only what Big Design's `GlobalStyles` doesn't provide and the app still needs (e.g. `html,body{margin:0}` if required, the reduced-motion block, and the off-canvas drawer keyframes if you kept them in CSS rather than styled-components). Everything else — palette, fonts, `.card`/`.btn`/`.chip`/etc. — is removed. If nothing remains needed, delete the file and its import in `layout.tsx`.

- [ ] **Step 4: Remove unused public logo assets (optional)**

If `public/silk-logo-color.svg` / `public/silk-logo-white.svg` are no longer referenced anywhere (re-run the grep), `git rm` them. Leave other public assets alone.

- [ ] **Step 5: Full verification sweep**

Run: `npm run type-check && npm run lint && npx vitest run && npm run build`
Expected: all PASS. Then `npm run dev` and walk every route: `/`, `/demo`, `/staff`, `/staff/po-inbox`, a session detail, `/staff/sessions`, `/staff/settings`, `/staff/simulator`, `/staff/usage`, an `/app-panel/...` route. Confirm: native BC look throughout, light-only, no Silk branding, no console errors, no hydration warnings.

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "chore(ui): remove Silk design system after Big Design migration [skip ship]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Foundation (deps, registry, ThemeProvider/GlobalStyles, next.config) → Task 1. ✓
- Remove old system (globals.css, theme toggle, dark tokens, Silk logos, fonts) → Tasks 1 (fonts/bootstrap) + 4/10 (logos/toggle in-place) + 11 (final delete). ✓
- Shell & nav → Task 4. ✓
- Shared primitives (ui.tsx, states.tsx) → Task 2. ✓
- Providers (toast, confirm) → Task 3. ✓
- Interactive forms (settings, simulator, reply-box, sessions-browser, gmail-connect) → Tasks 6, 7, 9. ✓
- Detail & public surfaces (inbox detail, sessions, usage, landing, demo, app-panel) → Tasks 8, 9, 10. ✓
- Component mapping table → embedded in File Structure + applied per task. ✓
- Bespoke widgets (timeline, kv, AI card, dots, banners, pre.block) → Task 2 (Banner) + Task 8 (detail-widgets). ✓
- Dark-mode removal → Task 1 (bootstrap) + Task 11 (tokens). ✓
- Testing/verification (type-check, lint, test, build, visual) → per-task gate + Task 11 sweep. ✓
- Rollout (single branch, `[skip ship]`, no auto-merge) → Global Constraints + every commit step. ✓
- Out of scope (no logic/API/lib changes) → Global Constraints. ✓

**Placeholder scan:** No "TBD/TODO/handle edge cases/similar to". Where a file's exact current exports must be preserved (confirm.tsx, states.tsx), the step instructs reading the file first and names the constraint (preserve exported names/signatures) rather than leaving content vague — this is a real instruction, not a placeholder.

**Type consistency:** `badgeVariant` name matches between `lib/ui/badge-variant.ts`, its test, and `ui.tsx`. `Banner({ kind, title, children })` signature matches its Task 2 definition and its Task 5/8 consumers. `useToast()` shape (`show/success/error/info`) unchanged across Tasks 3, 6, 7. `AlertsManager`/`createAlertsManager`, `Badge.label`/`variant`, `Counter.onCountChange`, `Switch.checked/onChange`, `Tabs.items/activeTab/onTabClick`, `Modal.actions` all match the verified `.d.ts`.
