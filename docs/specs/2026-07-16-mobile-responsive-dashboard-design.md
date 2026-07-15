# Mobile-Responsive Dashboard Design

**Status:** Approved — implementation complete<br>
**Date:** 16 Jul 2026<br>
**Scope:** The Stock Audit dashboard presentation at narrow phone widths.

## Goal

Make the existing Family Wealth dashboard comfortable to use at **390px** and
still usable at **320px**, without changing its data model, Excel workflow,
price-refresh behavior, Edit Mode gate, desktop layout, or selected 3D visual
direction.

## Chosen Direction

Keep the present design and all dashboard sections. Apply mobile-first layout
rules only below the existing desktop/tablet breakpoints instead of creating a
separate mobile dashboard.

## Layout Contract

- At 760px and below, the hero remains one visual story: compact copy stays
  legible over a smaller, right-aligned portrait; its three metrics become a
  dense vertical list instead of wide cards.
- At 620px and below, the sticky top bar becomes a compact brand row plus a
  full-width two-button action row. Buttons retain at least 42px touch height.
- At 520px and below, ownership, P&L, and dividend figures use stacked
  metadata and a full-width 3D bar area. Value labels must wrap or move below
  the chart rather than squeeze the canvas.
- At 390px, dashboard gutters become 12px and panel padding becomes 16px.
  The chart stage keeps enough height for touch interaction while avoiding
  below-the-fold blank space.
- At 320px, summary chips, cards, and long currency values remain inside their
  panels; tables retain their existing intentional horizontal scrolling.
- The 3D allocation ring stays interactive. Its exact-value detail list moves
  below the ring; the center value stays readable and never intercepts taps.
- The section tabs retain all labels and use horizontal scrolling without a
  visible scrollbar when space is constrained.

## Non-Goals and Safety Boundaries

- No portfolio calculations, workbook parsing, imported-workbook persistence,
  market-price refresh source, password behavior, or Excel export is changed.
- No live quote, API credential, Edit Mode password, or workbook content is
  moved into CSS or browser storage.
- Desktop and tablet composition above 760px remains visually unchanged unless
  a local overflow fix is required.

## Files and Tests

- Update `app/globals.css` for narrow-width layout, touch-target, overflow, and
  3D-stage rules.
- Update `app/dashboard/Dashboard.tsx` only if a semantic wrapper or accessible
  mobile hint is required; do not change finance logic.
- Add a regression assertion in `tests/rendered-html.test.mjs` that pins the
  mobile layout contract to the responsive stylesheet.
- Update `README.md` with the verified mobile viewport targets.
- Validate with the existing automated suite plus visual checks at 390×844 and
  320×568. Verify the current desktop-width page remains intact.

## Acceptance Checks

1. No horizontal page overflow at 390px or 320px, except inside intentional
   data-table wrappers.
2. Header actions, Import Excel, tabs, and Edit Mode remain reachable by touch.
3. The hero, ownership panel, allocation ring, P&L, and dividend panel keep
   all values visible without overlapping labels or canvas clipping.
4. 3D controls respect the existing reduced-motion behavior and stay keyboard
   accessible.
5. Existing dashboard server-render, model, workbook-editing, and market tests
   remain green.
