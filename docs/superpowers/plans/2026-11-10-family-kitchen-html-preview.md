# Family Kitchen HTML Preview

**Goal:** Produce a mobile HTML prototype for reviewing the visual direction already selected in the conversation.

**Scope:** A standalone preview under `miniapp/design-preview/`; no changes to application dependencies, cloud services, or existing business pages. Native HTML/CSS/JavaScript represent the intended Wot UI design language without installing a component library.

**Reference lock:** Kitchen Stories owns photo-led recipe presentation and readable steps; AnyList informs compact shopping rows; Samsung Food informs the recipe-to-plan-to-shopping journey. Preserve white surfaces, the existing `#216840` green action color, Chinese system typography, restrained 8–12px component radii, and real food photography. Photos and household data are samples.

**Files:** `index.html` contains the interface and local interactions; `assets/` contains downloaded sample photographs; `verify.cjs` checks interaction behavior with the existing jsdom dependency; `README.md` explains opening the preview and lists image sources.

- [x] Add an assert-based smoke test covering search, favorites, navigation, shopping, and import cancellation.
- [x] Build recipe browsing/detail, weekly planning, shopping, family, and add/import sheets.
- [x] Run the interaction smoke test and document prototype-only behavior.
- [ ] Complete automated browser/mobile visual inspection; Windows browser URL identification stopped the prior attempt. No rendered QA pass is claimed.

**2026-11-10 user decision:** The user accepted the preview's design and requested project documentation plus an independently startable UI refactoring issue. [Design baseline v1](../../design/miniapp/README.md) is the maintained specification; this file remains the prototype implementation record.

**Review focus:** Narrow screens; long or empty searches; canceling a pending import; safe display of user-entered text; all controls reachable without a mouse. Interactions are held in memory and reset on reload.
