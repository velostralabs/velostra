# Design system

> Last verified against frontend source and public rendering: 2026-07-20.
> Phase state: Phase 0-4 repository preparation has passed internal engineering/CI
> audit. The visual system remains current while mainnet execution stays gated.
> The current browser gate passes 17 checks with one intentionally guarded external
> MetaMask skip, and the production bundle remains within committed performance budgets.

Velostra memakai visual language dark institutional/financial: graphite surfaces,
acid-lime signal, cool ice accent, restrained champagne detail, geometric display
type, dense data labels, dan depth/motion yang tetap menjaga keterbacaan.

Canonical public visual surface: [https://velostra.xyz/](https://velostra.xyz/). It
is a static protocol preview; API-backed state is not part of this visual baseline.

## Source files

| File | Peran |
|---|---|
| `src/index.css` | Root tokens, reset, typography, global button/section primitives. |
| `src/polish.css` | Responsive console/page layouts, forms, tables, mobile navigation. |
| `src/luxury.css` | Ambient layers, premium motion, interaction effects, final refinements. |
| `src/components/PageShell.css` | Shared shell dan console surface. |
| Component CSS | Local section/page layout dan visuals. |
| BuilderPlatform.* | Revision, probe, analytics, notification, webhook operations. |
| GovernanceConsole.* | Moderation, privacy, telemetry, webhook recovery. |
| PrivacyCenter.* | User export/delete policy and request state. |
| `src/components/BrandMark.*` | Code-native Crystal V untuk navigation, footer, dan product motion. |
| `src/lib/chain.ts`, `src/components/WalletButton.*` | Chain definition, provider order, dan wallet-picker interaction. |
| `public/velostra-crystal-v*`, `favicon.svg`, `site.webmanifest` | Browser tab, launcher, dan installable identity assets. |
| `brand/*`, `docs/assets/velostra-hero.svg` | Editable public logo kit dan animated GitHub presentation asset. |
| `brand/social/*`, `public/velostra-social-card-1200x630.png` | X profile/header exports dan Open Graph/X link preview. |

Karena CSS cascade tersebar di global dan component files, perubahan token sebaiknya
dilakukan di `index.css`, sedangkan perubahan local harus tetap di component CSS.
Jangan menambah one-off inline style untuk page layout.

## Crystal V brand identity

Crystal V adalah canonical Velostra mark. Dua faceted wings melambangkan velocity
serta verified execution; settlement point di tengah melambangkan satu correlated
financial outcome. Jangan menggantinya dengan rounded/plain V pada product atau
public repository surfaces.

Rules:

- pertahankan silhouette, center separation, facet ridges, dan sumbu simetris;
- gunakan master `64 × 64` geometry untuk React/public assets dan simplified tab
  icon pada ukuran kecil;
- navigation/footer boleh memberi hover depth, tetapi geometry inti tidak berubah;
- favicon, manifest icons, README hero, dan downloadable brand kit harus berasal
  dari identity yang sama;
- outer card/connector pada README SVG tetap fixed. Motion hanya berada pada scan,
  pulse, line flow, dan facet shimmer supaya setiap captured GitHub frame lurus;
- semua SVG publik memiliki title/description atau konteks alt text yang sesuai.

### Social identity exports

Social exports berada di `brand/social/`: profile image 800 x 800 yang aman untuk
circular crop dan header X 1500 x 500. Website link preview memakai
`public/velostra-social-card-1200x630.png`; `index.html` menerbitkan metadata Open
Graph dan X yang sesuai. Semua asset publik hanya membawa atribusi Velostra.
`npm run test:social-assets` mengunci dimensi, metadata hygiene, dan link-preview tags.

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
- Netlify `dist/` publication plus `public/_redirects` preserves direct-route refresh;
- repository-root publication is invalid because it exposes `/src/main.tsx` instead
  of the built application.

Link internal harus memakai React Router `Link/NavLink`, bukan raw anchor, kecuali
external URL atau in-page accessible skip link.

## Wallet connection UX

`Connect Wallet` tidak lagi mengeksekusi connector pertama yang diumumkan browser.
Ia membuka explicit dialog dan mengurutkan pilihan sebagai berikut:

1. MetaMask first-class melalui `@metamask/connect-evm` untuk extension/mobile;
2. named EIP-6963 providers yang diumumkan browser;
3. generic injected fallback untuk Rainbow, Coinbase, atau provider lain.

Nama MetaMask dideduplikasi agar SDK dan injected announcement tidak membuat opsi
ganda. Setiap instance memakai `useId()` untuk `aria-controls`, memiliki pending dan
error state, menutup lewat Escape/outside click, dan mempertahankan provider choice
sebagai aksi eksplisit user. UI tidak pernah meminta, membaca, atau menyimpan seed
phrase/private key.

Picker/browser smoke membuktikan rendering dan state interaction. Real extension
permission, account access, signature rejection, wrong-chain switch, serta onchain
transaction tetap harus dibuktikan oleh browser-wallet E2E sebelum release.

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
- wallet dialog dengan unique `aria-controls`, explicit provider labels, pending/error state, dan Escape/outside dismissal;
- visible focus states;
- form `label`/`htmlFor` pairs;
- async loading/status roles;
- `prefers-reduced-motion` CSS dan runtime checks;
- pointer effects disabled/simplified pada touch/coarse pointer;
- decorative motion `aria-hidden`.

Automated axe/Playwright coverage is part of CI. Still required before real-value
release: a manual screen-reader pass, zoom 200/400%, contrast review across every
state, and keyboard testing of wallet/third-party UI.

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
requestAnimationFrame batching pada interface cursor, dan lazy MetaMask SDK chunks
yang baru dimuat ketika connection path memerlukannya.

Committed browser gates enforce entry/async/total gzip budgets plus route LCP, INP,
CLS, accessibility, collision/overflow, routing-state, and visual baselines.
A public Netlify smoke now proves valid TLS, hashed bundle delivery, and full landing
rendering at the canonical domain. The guarded real-MetaMask and managed-staging
performance evidence remain external
release gates. New Phase 4 panels must preserve async/error/empty states and must not
pull Three.js or wallet SDK chunks into unrelated routes.

## Visual QA checklist

- 1440, 1280, 1024/980, 820/768, 390, dan 320 widths;
- long titles, empty data, error/loading, large wallet/address;
- mouse, touch, keyboard, reduced motion;
- MetaMask/injected option dedupe, picker bounds, Escape/outside dismissal, rejected provider, dan wrong-chain state;
- no horizontal overflow atau clipped focus;
- menu safe area dan sticky navigation;
- 3D fallback/scene parity;
- direct route refresh dan back/forward transition;
- revision publish/rollback/probe, webhook rotation/pause, moderation/privacy/
  telemetry loading/error/empty/success states;
- typography fallback ketika Google Fonts gagal.
