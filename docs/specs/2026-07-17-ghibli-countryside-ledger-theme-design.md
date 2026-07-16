# Ghibli Countryside Ledger Theme

Date: 17 Jul 2026
Status: Approved — direction A

## Goal

Restyle the existing Family Stocks dashboard as a warm countryside ledger:
cream paper, forest green, watercolor sky, hand-drawn-feeling borders, soft
sunlight, and painted-clay 3D charts. The result should feel illustrated and
personal while keeping every financial value easy to scan.

## Approved direction

The selected direction is **A — Ghibli Countryside Ledger**. It applies one
coherent visual language across the header, status banners, import surface,
navigation, hero, overview cards, secondary tabs, tables, Edit Mode, password
dialog, footer, R3F charts, and their no-WebGL fallbacks.

This is a presentation-only change. It does not alter portfolio calculations,
PostgreSQL persistence, market refresh, workbook import/export, authentication,
labels, tab order, or information architecture.

## Visual system

- **Paper:** warm cream surfaces with a low-contrast CSS grain and watercolor
  wash. No external texture or font request is required.
- **Forest:** deep green replaces the blue-black navigation and is the primary
  action/ink accent.
- **Sky:** desaturated blue-green supports status and chart backgrounds.
- **Sun:** muted ochre highlights primary refresh actions, invested-capital
  marks, warnings, and selected states.
- **Ink:** dark green-gray retains strong contrast for values and headings.
- **Edges:** cards use slightly asymmetric radii, fine olive borders, and soft
  pigment-like shadows. The structure and spacing remain unchanged.
- **Motion:** hover movement remains restrained. Reduced-motion preferences
  continue to disable decorative transitions.

## Header, controls, and surfaces

The sticky header becomes a dark forest canopy with a subtle watercolor glow.
The SA mark reads as a small painted seal. Buttons, tabs, inputs, banners,
tables, and dialogs use the same paper/forest/sun tokens, with visible keyboard
focus and at least 44 px touch targets where the current responsive contract
requires them.

The existing family portrait remains the hero artwork. A warm paper-to-sky wash
protects the value text without cropping the family on narrow screens. New
decorative layers must stay behind content and must not capture pointer events.

## R3F charts

The allocation ring and three compact bar fields retain their current data,
geometry, labels, click/tap behavior, demand rendering, and reduced-motion
behavior. Only their material and lighting art direction changes:

- rough, nearly non-metallic painted-clay materials;
- warm directional sunlight and cool sky fill;
- soft moss-colored ground light and contact shadows;
- gentle highlights on the selected segment/bar without neon emissive glare.

The CSS allocation ring and compact-bar fallbacks receive matching pigment
shading and remain clickable or readable when WebGL is unavailable.

## Responsive and accessibility contract

- Preserve the current desktop layout and the existing mobile structure.
- Verify desktop and 393 × 852; remain usable from the existing 320 px minimum.
- Do not introduce horizontal page overflow or overlap chart labels/values.
- Preserve R3F pointer/touch selection and the clickable allocation fallback.
- Keep text contrast readable over the hero and on every paper surface.
- Preserve focus-visible outlines and `prefers-reduced-motion` behavior.

## Files and verification

Implementation touches `app/dashboard/Dashboard.tsx`, `app/globals.css`,
`tests/rendered-html.test.mjs`, this spec, and `README.md`. Verification requires
the rendered regression suite, typecheck, lint, production build, and visual QA
at desktop and 393 × 852 with the existing data and runtime behavior intact.
