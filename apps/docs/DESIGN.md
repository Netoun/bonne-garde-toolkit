# Docs site art direction

## Intention

Terminal first: every guide opens with a command and its output, so code sits in a dark terminal panel that stands out in light and in dark, and prose stays calm around it. The site is the toolkit's default theme (`docs/DESIGN.md`) plus a handful of `--docs-*` tokens for the chrome, never a second design system.

## Tokens

- Docs-only tokens live in `app/app.css`, prefixed `--docs-`, exposed to Tailwind as `--color-docs-*` (`bg-docs-code`, `border-docs-accent`…).
- `app/app.css` never redeclares a default theme token (`--background`, `--primary`…): item previews share the page and must render the default theme.
- Item and module previews (`components/item`, `components/module`, `demos/`) use no `docs-` class.

## Type scale

| Role                | Font                     | Size / line height | Weight |
| ------------------- | ------------------------ | ------------------ | ------ |
| Page title (`h1`)   | `--font-heading`         | 2.25rem / 2.5rem   | 700    |
| Section (`h2`)      | `--font-heading`         | 1.5rem / 2rem      | 600    |
| Subsection (`h3`)   | `--font-heading`         | 1.25rem / 1.75rem  | 600    |
| Body                | `--font-sans`            | 1rem / 1.75rem     | 400    |
| Nav, captions       | `--font-sans`            | 0.875rem           | 500    |
| Sidebar group label | `--font-sans`, uppercase | 0.6875rem, 0.08em  | 600    |
| Code, caption bar   | `--font-mono`            | 0.875rem / 0.75rem | 400    |
| Home title          | `--font-heading`         | 3rem from `sm`     | 700    |

## Colour roles

Every text/background pair below is checked in light and in dark by `app/app.css.test.ts`. A pair added here is tested.

| Pair                   | Text                          | Background             | Min |
| ---------------------- | ----------------------------- | ---------------------- | --- |
| Body text              | `--foreground`                | `--background`         | 4.5 |
| Secondary text         | `--muted-foreground`          | `--background`         | 4.5 |
| Sidebar link           | `--sidebar-foreground`        | `--sidebar-background` | 4.5 |
| Sidebar group label    | `--muted-foreground`          | `--sidebar-background` | 4.5 |
| Sidebar active link    | `--sidebar-accent-foreground` | `--sidebar-accent`     | 4.5 |
| Code text              | `--docs-code-foreground`      | `--docs-code`          | 4.5 |
| Code caption           | `--docs-code-muted`           | `--docs-code`          | 4.5 |
| Accent mark (non-text) | `--docs-accent`               | `--background`         | 3   |
| Accent mark in sidebar | `--docs-accent`               | `--sidebar-background` | 3   |

- `--docs-accent` marks state and links: active nav underline, active sidebar bar, link underline. It is never a text colour.
- `--primary` is never a text colour on `--background` (light `--primary` is too pale).

## Layout and reading width

- Header 3.5rem high (`h-14`), sticky, `bg-background/95` with backdrop blur, bottom border.
- Reading column `max-w-3xl`; paragraphs, lists and quotes stop at `--docs-measure` (70ch).
- Table of contents from `xl`, 13rem wide. Below `md` the sidebar is a drawer.
- Home: hero and quick start side by side from `lg`, stacked below; nothing scrolls sideways at 360px.

## Code blocks

- Surface `bg-docs-code`, text `text-docs-code-foreground`, border `border-docs-code-border`, radius `rounded-lg`, in both themes.
- Shiki uses its dark palette inside `.docs-code` in both themes.
- Optional caption bar: `font-mono`, 0.75rem, `text-docs-code-muted`, bottom border `border-docs-code-border`.
- Copy button top right, label `Copy`, then `Copied` for 2s.
- Inline code: `bg-muted`, `border`, `font-mono`, 0.85em.

## Sidebar and header

- Header brand: logo 28px, name in `--font-heading`.
- Header nav: active link `text-foreground` with a 2px `border-docs-accent` underline, others `text-muted-foreground`.
- Sidebar group labels: uppercase, 0.6875rem, `tracking-[0.08em]`, `text-muted-foreground`.
- Sidebar active link: `--sidebar-accent` background and a 2px `--docs-accent` bar on its left edge.

## Motion

- Colour and opacity transitions only, `duration-150`, on links, buttons and nav items.
- No entrance animation on reading pages. Every transition has `motion-reduce:transition-none`.

## Do / don't

- Do put each command in a `CodeBlock`, never in a paragraph.
- Do add a docs-only colour as a `--docs-*` token with its pair in the table above.
- Don't use `--primary` or `--docs-accent` as text colour on the page background.
- Don't style a preview: `components/item`, `components/module` and `demos/` show what a user gets.
- Don't add a font: Urbanist, Faustina and the system mono stack only.
