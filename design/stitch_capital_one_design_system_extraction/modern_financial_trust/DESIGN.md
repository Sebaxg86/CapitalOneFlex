---
name: Modern Financial Trust
colors:
  surface: '#fcf9f8'
  surface-dim: '#dcd9d9'
  surface-bright: '#fcf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f2'
  surface-container: '#f0edec'
  surface-container-high: '#ebe7e7'
  surface-container-highest: '#e5e2e1'
  on-surface: '#1c1b1b'
  on-surface-variant: '#404850'
  inverse-surface: '#313030'
  inverse-on-surface: '#f3f0ef'
  outline: '#707881'
  outline-variant: '#bfc7d1'
  surface-tint: '#006496'
  primary: '#005c8c'
  on-primary: '#ffffff'
  primary-container: '#0276b1'
  on-primary-container: '#eff6ff'
  inverse-primary: '#91ccff'
  secondary: '#b51b17'
  on-secondary: '#ffffff'
  secondary-container: '#d9372c'
  on-secondary-container: '#fffbff'
  tertiary: '#265b86'
  on-tertiary: '#ffffff'
  tertiary-container: '#4374a0'
  on-tertiary-container: '#f0f5ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#cce5ff'
  primary-fixed-dim: '#91ccff'
  on-primary-fixed: '#001e31'
  on-primary-fixed-variant: '#004b73'
  secondary-fixed: '#ffdad5'
  secondary-fixed-dim: '#ffb4aa'
  on-secondary-fixed: '#410001'
  on-secondary-fixed-variant: '#930006'
  tertiary-fixed: '#cee5ff'
  tertiary-fixed-dim: '#9bcbfc'
  on-tertiary-fixed: '#001d33'
  on-tertiary-fixed-variant: '#0d4a74'
  background: '#fcf9f8'
  on-background: '#1c1b1b'
  surface-variant: '#e5e2e1'
  surface-base: '#FFFFFF'
  surface-alt: '#F4F4F4'
  surface-dark: '#3D3D3D'
  text-primary: '#141414'
  text-secondary: '#3D3D3D'
  text-muted: '#666666'
  action-hover: '#015B8A'
  border-subtle: '#E5E5E5'
  border-strong: '#B0B0B0'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 44px
    fontWeight: '700'
    lineHeight: 52px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 26px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  caption:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-eyebrow:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.08em
  button-text:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
  space-2xl: 4rem
---

## Brand & Style

The design system embodies modern consumer and enterprise banking: trustworthy, precise, approachable, and rigorously structured. It delivers high-clarity financial interactions that instill confidence across self-service account management, lending journeys, and card product comparisons.

### Design Movement
The system relies on a **Corporate / Modern** framework built upon crisp layout geometry, clean photographic integration, clear information hierarchy, and restrained interactive color accents. It rejects unnecessary ornamentation, relying instead on deliberate typographic scale, high text-to-background contrast, and structured white space to project institutional security and modern operational agility.

### Emotional Demeanor
- **Dependable:** High contrast typography and strict grid alignments provide clarity in financial decision-making.
- **Approachable:** Generous whitespace, clean sans-serif typography, and subtle rounded interactive components keep financial services intuitive and human.
- **Focused:** Accent colors are applied strictly to primary actions, contextual hyperlinks, and active states to guide user focus without distraction.

## Colors

The palette establishes an accessible, high-contrast banking hierarchy adhering strictly to WCAG 2.1 AA and AAA standards.

### Functional Roles
- **Primary (`#0276B1`):** The signature vibrant blue applied across key calls to action, text link accents, interactive icon highlights, and primary status markers.
- **Secondary (`#D03027`):** A high-visibility security red reserved for brand-level marks, urgent notifications, promotional badges, and critical warning triggers.
- **Tertiary (`#0F4B75`):** A deep corporate navy utilized for high-emphasis headings, inverted navigation surfaces, and active selection borders.
- **Neutral (`#141414`):** Near-black charcoal used for primary text rendering on light surfaces, ensuring maximum optical density and reading comfort.
- **Surfaces (`#FFFFFF`, `#F4F4F4`, `#3D3D3D`):** Base canvas starts with pure `#FFFFFF`. Sectional alternation and card backgrounds use neutral container `#F4F4F4`. Deep footer blocks and regulatory legal disclosures leverage `#3D3D3D` and dark neutral backdrops with reversed `#FFFFFF` typography.

## Typography

The typographic hierarchy prioritizes rapid scanning, legibility of legal and numerical data, and structural hierarchy. **Inter** serves as the system standard across headlines, body copy, and UI controls, matching the geometric precision, tall x-height, and neutral clarity seen in the reference interface.

### Application Principles
- **Eyebrows & Section Markers:** Displayed in uppercase (`label-eyebrow`) with positive letter-spacing (`0.08em`) and heavy weight to categorise blocks cleanly.
- **Hero Headlines:** Restrained negative tracking (`-0.02em` to `-0.015em`) tightens large titles, preventing loose letterforms in high-impact value propositions.
- **Body & Numerical Information:** Body sizes retain standard tracking and proportional height for financial tables, rates, and disclosure terms.

## Layout & Spacing

The layout is built on a responsive 12-column fixed-max grid structured to keep wide displays balanced while ensuring dense mobile utility.

### Grid & Breakpoints
- **Desktop (1200px+):** Max layout container width of `1280px` centered with `margin: 2rem` and `gutter: 1.5rem` (24px). Feature rows split into equal thirds (3-column cards) or asymmetric 6/6 split banners.
- **Tablet (768px - 1199px):** 8-column layout with `gutter: 1rem` (16px) and `margin: 1.5rem` (24px). Multi-column product cards reflow into 2x2 grids.
- **Mobile (0px - 767px):** 4-column fluid layout with `gutter-mobile: 1rem` and `margin-mobile: 1rem`. All multi-column cards stack vertically or convert into horizontal swipe containers.

### Spacing Rhythm
Sectional transitions use `space-2xl` (64px) on desktop and `space-xl` (40px) on mobile. Micro-spacing between headings, supporting descriptions, and call-to-action links maintains a tight structural cadence of `0.5rem` to `1rem`.

## Elevation & Depth

The design system uses low-elevation depth: structural hierarchy is predominantly established via tonal layering and clean dividing strokes rather than exaggerated shadows.

### Elevation Levels
- **Level 0 (Flat):** Base canvas and editorial content blocks sitting directly on `#FFFFFF` or `#F4F4F4` with zero shadow.
- **Level 1 (Subtle Card Elevation):** Used for promotional containers, floating hero highlight cards, and authentication modals:
  `box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08)`.
- **Level 2 (Hover / Active States):** Interactive product cards lift smoothly on cursor engagement:
  `box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12)`.
- **Level 3 (Sticky Navigation / Modals):** Top utility navigation bars and fixed bottom drawer items:
  `box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15)`.

### Border Structure
Card containers and form fields utilize sharp 1px borders in `#E5E5E5` to retain clarity when shadows are disabled in accessibility modes.

## Shapes

The design system uses a **Soft** shape language (`roundedness: 1`). Financial institutions require an aesthetic of structural integrity and stability; extreme curves can diminish gravity, while entirely sharp edges can feel outdated.

### Corner Radius Standards
- **Buttons & Form Fields:** `0.25rem` (4px) corner radius for clean, functional clarity.
- **Cards & Floating Panels:** `0.5rem` (8px) (`rounded-lg`) corner radius for subtle softness that frames imagery and content.
- **Filter Pills & Category Badges:** `1.5rem` (24px) for distinct interactive distinction from standard rectangular buttons.

## Components

### Buttons
- **Primary Button:** Background `#0276B1`, text `#FFFFFF`, border-radius `4px`, padding `10px 20px`. Hover state transitions to `#015B8A`. Focus ring shows a distinct 2px outer outline with a 2px offset.
- **Secondary / Outline Button:** Transparent background, 1.5px solid border in `#0276B1`, text `#0276B1`. Hover state fills with `rgba(2, 118, 177, 0.06)`.
- **Text Link with Chevron:** Standard inline or standalone action consisting of `#0276B1` bold text followed by a right chevron (`›`). Underlines appear on hover.

### Inputs & Authentication Controls
- **Text Inputs:** Height 44px, border `1px solid #B0B0B0`, background `#FFFFFF`, text `#141414`, padding `0 12px`, border-radius `4px`.
- **Leading Icon Input:** Icons (such as user or lock symbols) rendered in `#666666` at 18px size, vertically centered with an 8px right offset to the text.
- **Focus State:** 2px border `#0276B1` with no displacement.

### Selection Controls
- **Checkboxes:** 18px square with 2px border radius. Unselected uses `#B0B0B0` outline; checked states fill with `#0276B1` and an inset white checkmark.
- **Radio Buttons:** 18px circular control with `#0276B1` filled circle indicator when active.

### Product & Service Cards
- **Editorial / Promotional Card:** White canvas (`#FFFFFF`) with a top or left photographic block, padding `24px`, featuring an uppercase category eyebrow, medium bold headline, body text, and an anchored text action link at the bottom.
- **Feature Category Box:** Centered icon illustration (64px x 64px), bold headline (`20px`), concise description (`14px`), and a direct textual chevron link.

### Sticky / Floating Bottom Bar
- **Topic Filter Bar:** Contained interactive footer or sticky utility strip with centered pill-shaped toggles (`rounded: 24px`), including an active pill state filled in `#0276B1` with `#FFFFFF` text and inactive items utilizing `#FFFFFF` background with `#3D3D3D` text and border `#E5E5E5`.