# Design system

> Last verified against frontend source: 2026-07-14.

Velostra memakai visual language dark institutional/financial: graphite surfaces,
acid-lime signal, cool ice accent, restrained champagne detail, geometric display
type, dense data labels, dan depth/motion yang tetap menjaga keterbacaan.

## Source files

| File | Peran |
|---|---|
| `src/index.css` | Root tokens, reset, typography, global button/section primitives. |
| `src/polish.css` | Responsive console/page layouts, forms, tables, mobile navigation. |
| `src/luxury.css` | Ambient layers, premium motion, interaction effects, final refinements. |
| `src/components/PageShell.css` | Shared shell dan console surface. |
| Component CSS | Local section/page layout dan visuals. |
| `src/components/BrandMark.*` | Logo mark yang dipakai nav/loading/favicon language. |

Karena CSS cascade tersebar di global dan component files, perubahan token sebaiknya
dilakukan di `index.css`, sedangkan perubahan local harus tetap di component CSS.
Jangan menambah one-off inline style untuk page layout.

## Color tokens

Primary root tokens:

```css
--bg-0: #050609;
--bg-1: #090c11;
--bg-2: #0e131a;
--bg-3: #151b24;
--signal: #c9ff5f;
--ice: #8fe9dc;
--champagne: #d6b684;
--danger: #ef7168;
--text-0: #f1f3ed;
--text-1: #aab1ab;
--text-2: #6f7774;
```

Rules:

- `signal` untuk primary action, active state, dan settlement proof;
- `ice` untuk secondary technical depth;
- `champagne` hanya sebagai premium accent, bukan competing CTA;
- status/error tidak boleh hanya dibedakan lewat warna;
- body text memakai `text-0/text-1`; `text-2` hanya untuk non-critical metadata.

## Typography

Fonts dimuat dari Google Fonts di `index.html`:

- Display: **Space Grotesk** 500/600/700;
- Body: **Manrope** 400/500/600/700;
- Mono: system `SFMono-Regular`, Consolas, Liberation Mono.

Display memakai tight negative tracking dan balanced line wrap. Body copy menjaga
line-height long-form. Mono hanya untuk amount, ID, address, route/chain metadata,
dan eyebrow label—bukan seluruh UI.

Font memiliki sans-serif/system fallback. Jika privacy/self-hosting dibutuhkan,
pindahkan font files ke asset lokal sebelum production.

## Layout dan responsive behavior

Root minimum width adalah 320px; tidak lagi desktop-only.

Key breakpoints yang dipakai komponen:

- sekitar 1180/1100px: desktop grid mulai mengompak;
- 980/900/821px: navigation switch, landing grid stack, WebGL eligibility;
- 760/620px: mobile spacing, field/table adaptation, visual simplification;
- 520px: compact mobile controls dan typography.

Navigation desktop berubah menjadi animated mobile menu di bawah 980px. Menu hanya
dimount saat terbuka, punya `aria-expanded`, Escape close, focus return, active
route state, dan safe-area padding.

New sections harus menggunakan fluid `clamp()`, minmax grids, content max width,
dan existing panel/field/table primitives. Jangan mengembalikan fixed desktop
canvas/min-width lama.

## Routing UX

Semantic routes menggantikan hash navigation:

- `/system`, `/proof`, `/economics` scroll ke landing section;
- legacy `/#system`, `/#proof`, `/#economics`, `/#marketplace` di-canonicalize;
- route transition menggunakan `AnimatePresence` + `PageTransition`;
- non-home pages lazy-loaded;
- `RouteManager` menangani scroll restore dan page titles;
- marketplace query filter dinormalisasi di URL.

Link internal harus memakai React Router `Link/NavLink`, bukan raw anchor, kecuali
external URL atau in-page accessible skip link.

## Motion system

Base easing:

```css
--ease-premium: cubic-bezier(0.16, 1, 0.3, 1);
```

Motion layers:

1. route/page reveal;
2. scroll-linked section reveal;
3. component state transition;
4. spring-smoothed pointer parallax;
5. subtle ambient cursor light/reticle/scan;
6. data motion such as settlement traces, chart lines, and progress.

`HowItWorks` auto-advances every 3.2s dan berhenti saat user berinteraksi.
`SettlementProof` auto-advances every 2.4s, bisa dipilih manual, dan memiliki
reactive orbital parallax. Hero/marketplace artifacts memakai spring-smoothed
pointer response. Motion harus mengomunikasikan state/depth, bukan menunda action.

## Adaptive 3D

Hero execution artifact memakai React Three Fiber/Three.js:

- lazy import setelah viewport query match;
- hanya aktif pada minimum 821px dan `prefers-reduced-motion: no-preference`;
- poster CSS fallback pada mobile/reduced-motion;
- 320ms deferred enable untuk memprioritaskan first content;
- device pixel ratio capped 1–1.3;
- antialias disabled dan high-performance preference;
- render loop berubah ke demand saat reduced/hidden/outside observed area;
- pointer and scroll input di-damp, bukan direct snap.

Three.js tetap chunk besar. Pertahankan async boundary dan ukur real-device LCP,
INP, memory, battery, dan crash rate sebelum menambah scene baru.

## Accessibility

Implemented baseline:

- skip link ke `#main-content`;
- semantic primary/mobile `nav` labels;
- Escape-close menu dan focus return;
- visible focus states;
- form `label`/`htmlFor` pairs;
- async loading/status roles;
- `prefers-reduced-motion` CSS dan runtime checks;
- pointer effects disabled/simplified pada touch/coarse pointer;
- decorative motion `aria-hidden`.

Still required before release: automated axe/Playwright checks, screen-reader pass,
zoom 200/400%, contrast audit seluruh states, and keyboard test seluruh wallet
modals/third-party UI.

## Component conventions

- Gunakan `.btn`, `.panel`, `.field-row`, `.table`, `.badge`, `.empty-state`,
  `.section-*`, dan page shell sebelum membuat primitive baru.
- Satu primary CTA per decision area.
- Amount/alamat memakai mono dan alignment konsisten.
- Loading, empty, error, disabled, success, and pending state wajib didesain.
- Interactive card harus punya real link/button semantics.
- Jangan membuat cursor-only interaction; hover enhancement harus optional.
- Jangan menjalankan infinite animation jika element hidden atau reduced-motion aktif.

## Performance guardrail

Current protections: route lazy loading, async 3D chunk, viewport/motion gating,
capped DPR, visibility/intersection suspension, passive pointer/scroll listeners,
dan requestAnimationFrame batching pada interface cursor.

Release budget formal belum diset. Phase 2 harus mencatat baseline per route dan
menetapkan budget untuk JS gzip, LCP, INP, CLS, WebGL memory, and mobile CPU.

## Visual QA checklist

- 1440, 1280, 1024/980, 820/768, 390, dan 320 widths;
- long titles, empty data, error/loading, large wallet/address;
- mouse, touch, keyboard, reduced motion;
- no horizontal overflow atau clipped focus;
- menu safe area dan sticky navigation;
- 3D fallback/scene parity;
- direct route refresh dan back/forward transition;
- typography fallback ketika Google Fonts gagal.