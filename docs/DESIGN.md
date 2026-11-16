# Design system & theming

Shared UI lives in `{{SCOPE}}/ui` (`packages/ui` of a project with the `ui/shadcn` module, whose template is `registry/modules/ui/shadcn/template/packages/ui/`). Visual identity is split between **global styles** (Tailwind setup, base rules, utilities, animations) and **theme packs** (colors, type, radius, shadows, motion tokens).

---

## 1. File layout

| File                                        | Role                                                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ui/src/styles/globals.css`        | Tailwind v4 entry: `@import "tailwindcss"`, `@source`, plugins, dark variant, theme import, `@layer base`, scrollbars, `@utility` helpers, keyframe animations |
| `packages/ui/src/styles/themes/default.css` | Default theme: `:root` / `.dark` CSS variables, `@theme inline` mappings for Tailwind                                                                          |

Apps import the bundle once:

```ts
import "{{SCOPE}}/ui/globals.css";
```

To depend on a theme file directly (e.g. custom globals that re-import Tailwind yourself):

```ts
import "{{SCOPE}}/ui/themes/default.css";
```

---

## 2. Swapping or extending themes

1. **Copy** `packages/ui/src/styles/themes/default.css` to a new file, e.g. `themes/acme.css`.
2. **Edit** semantic tokens (`--primary`, `--background`, `--font-sans`, `--radius`, `--shadow-lg`, etc.) and the matching `@theme inline` block so Tailwind utilities stay in sync.
3. **Point** `globals.css` at your theme:

   ```css
   @import "./themes/acme.css";
   ```

   Or replace the default import path in a forked `globals.css` if the app owns its own style entry.

4. **Keep** variable names stable. Components use shadcn/Tailwind tokens (`bg-primary`, `text-muted-foreground`, `rounded-lg`, `shadow-cozy`, etc.). Renaming `--primary` without updating `@theme inline` breaks utilities.

5. **Dark mode**: override the same token names under `.dark { ... }` in the theme file. The `dark` variant is defined in `globals.css` (`@custom-variant dark`).

6. **Optional export**: add `"./themes/your-theme.css"` under `packages/ui/package.json` → `exports` if other packages should import it by package path.

---

## 3. Default theme — overview

The default theme is **cozy and rounded**: soft elevation, generous radius, and a calm multi-hue palette. It is tuned for long-form UI (dashboards, forms, dense tables) without harsh contrast.

**Characteristics:**

- Periwinkle primary, terracotta secondary, sage tertiary
- Large default radius; pills for badges and avatars
- Faustina serif headings + Urbanist sans body (load fonts in the app entry)
- Spring-leaning transition tokens (`--transition-spring`) used by shared animations
- Soft, diffused shadows; full light/dark token sets

---

## 4. Default theme — color roles

### Backgrounds & surfaces

- **Background**: Main page surface. Near-white with a faint violet undertone (light); deep desaturated indigo (dark).
- **Card**: Slightly elevated panels and form sections.
- **Popover**: Lightest floating surface (menus, tooltips).

### Accent colors

- **Primary**: Cool blue-violet — primary CTAs, active states, focus rings.
- **Secondary**: Warm terracotta — secondary emphasis, energetic badges.
- **Tertiary**: Muted sage — success, completion, positive status.

### Neutrals & utility

- **Muted**: De-emphasised backgrounds and helper text.
- **Accent**: Pale gold — hover on ghost/nav items, not standalone decoration.
- **Foreground**: Body text; slightly warm near-black / near-white.

### Semantic

- **Destructive**: Brick red — delete, errors, irreversible actions only.
- **Border / input / ring**: Structure and focus; keep borders subtle.

### Sidebar

Parallel token set (`--sidebar-*`) tuned for a narrow navigation column. Mirror main semantics; slightly cooler and more recessed.

All values are OKLCH in `themes/default.css` under `:root` and `.dark`.

---

## 5. Default theme — typography

- **Urbanist** (`--font-sans`): Body, labels, buttons, inputs. Base layer sets medium weight on `body`.
- **Faustina** (`--font-heading`): `h1`–`h6` only; semibold, tight tracking.

Load Fontsource (or your host) in each app; the theme only declares family stacks.

**Principles:**

- Tight tracking on headings; avoid wide letter-spacing.
- Prefer semibold headings and medium body; avoid light weights for UI copy.

---

## 6. Default theme — radius & shadows

- **Radius**: `--radius` default `0.75rem`; scale through `--radius-sm` … `--radius-2xl` and `--radius-full`.
- **Shadows**: `--shadow-xs` through `--shadow-xl`, plus `--shadow-cozy` and `--shadow-float` for cards and overlays. Prefer blur over hard offsets.

| Level       | Token (typical)            | Use                          |
| ----------- | -------------------------- | ---------------------------- |
| Hairline    | `--shadow-xs`              | Chips, tags                  |
| Resting     | `--shadow-sm` / `--shadow` | Cards at rest                |
| Comfortable | `--shadow-md`              | Dropdowns, interactive cards |
| Raised      | `--shadow-lg`              | Modals, toasts               |
| Hovering    | `--shadow-xl`              | Hover elevation              |
| Floating    | `--shadow-float`           | Sheets, overlays             |

---

## 7. Shared globals (not in theme files)

These stay in `globals.css` so any theme reuses the same behavior:

- **Base layer**: border color on `*`, body typography, heading font family, text selection (uses `--selection-*` from the active theme).
- **Scrollbar**: WebKit thumb colors from `--scrollbar-thumb` / `--scrollbar-thumb-hover`.
- **Utilities**: `transition-cozy*`, `shadow-hover`, `focus-ring`, `interactive`.
- **Animations**: `float`, `gentle-pulse`, `scale-in`, `slide-up` (durations use theme `--transition-*` tokens).

---

## 8. Components (shadcn / `{{SCOPE}}/ui`)

Buttons, badges, cards, and layout primitives follow the active theme tokens. Variants map to semantic colors (`primary`, `secondary`, `tertiary`, `destructive`, `outline`, `ghost`). Prefer one strong primary action per view; use size and variant for hierarchy, not one-off hex values.

When generating UI against the **default theme**:

- Lead with primary for the main action; secondary/tertiary for alternate or status emphasis.
- Headings in heading font; UI copy in sans.
- Round interactive surfaces; use destructive only for dangerous actions.
- Cards: resting shadow, lift + larger shadow on hover where appropriate.
- Motion: use shared utilities and `--transition-spring` for entrances; keep disabled controls static.

---

## 9. Checklist for a new theme

- [ ] All shadcn semantic variables defined in `:root` and `.dark`
- [ ] `@theme inline` maps each `--color-*`, radius, and shadow to `var(--...)`
- [ ] `--selection-*` and `--scrollbar-*` if you change chrome colors
- [ ] `--transition-*` if motion should feel different
- [ ] Fonts declared in `@theme inline` and loaded in the app
- [ ] Smoke-test light/dark toggling on auth, sidebar, and a card-heavy page
