# Stimulus UI

A collection of 38 headless Stimulus controllers for accessible interfaces. Write your HTML and CSS; Stimulus UI adds keyboard interaction, state synchronization, and the ARIA behavior defined by each component's contract.

The library provides the following four items:

- Controllers: Connect behavior using `data-controller`
- `data-*` attributes: Express discrete states readable by CSS
- CSS custom properties: Express continuous values readable by CSS
- Custom events: Provide extension points for the consuming side

It does not distribute class names. Visual appearances are defined using the user's CSS or a separate design system.

## Installation

Install the package and its Stimulus peer dependency:

```sh
vp add @tknf/stimulus-ui @hotwired/stimulus
```

Stimulus `^3.2.2` is the only runtime peer dependency. The package provides ES modules and TypeScript declarations. It works with server-rendered HTML and does not require Turbo, a particular server framework, Shadow DOM, or a CSS framework.

## Registration

Register only the controllers you use with your Stimulus application. If your application already starts Stimulus, use that existing `Application` instance.

```ts
import { Application } from "@hotwired/stimulus";
import { TabsController } from "@tknf/stimulus-ui";

const application = Application.start();
application.register("tabs", TabsController);
```

The controller enhances markup you provide. For example:

```html
<div data-controller="tabs">
  <div data-tabs-target="tablist" role="tablist" aria-label="Account settings">
    <button
      id="account-tab"
      type="button"
      role="tab"
      aria-controls="account-panel"
      aria-selected="true"
      data-tabs-target="tab"
      data-tabs-value="account"
    >
      Account
    </button>
    <button
      id="security-tab"
      type="button"
      role="tab"
      aria-controls="security-panel"
      aria-selected="false"
      data-tabs-target="tab"
      data-tabs-value="security"
    >
      Security
    </button>
  </div>
  <section
    id="account-panel"
    role="tabpanel"
    aria-labelledby="account-tab"
    data-tabs-target="tabpanel"
    data-tabs-value="account"
  >
    Account settings
  </section>
  <section
    id="security-panel"
    role="tabpanel"
    aria-labelledby="security-tab"
    data-tabs-target="tabpanel"
    data-tabs-value="security"
    hidden
  >
    Security settings
  </section>
</div>
```

Use unique IDs if you repeat the example. Controllers preserve authored structure and manage the state and relationships assigned to them by their contracts. Missing static attributes produce a console warning when completed; invalid required markup disables enhancement until repaired.

## Behavior and accessibility

Use native elements and provide meaningful accessible names and content. The library handles component behavior; your application remains responsible for styling, contrast, layout, and content. Browser tests run on Chromium, Firefox, and WebKit. Each contract records its keyboard behavior, accessibility requirements, and any unverified assistive-technology observations; passing automated tests is not a claim of complete screen-reader verification.

Configure controllers through Stimulus values and operate them through their public properties and methods. Programmatic changes do not emit custom events. User interactions emit component-prefixed events; cancelable `before` events let your application prevent an operation. Consult each contract for its exact API and event detail.

## Components

The API, markup, keyboard interactions, state outputs, and events for each component are defined in their corresponding contracts.

- `password-field` — A password field consisting of a native password input and a toggle display button ([contract](design/contracts/password-field.contract.json))
- `tabs` — Single-select tabs following the WAI-ARIA APG Tabs Pattern ([contract](design/contracts/tabs.contract.json))
- `dialog` — A native modal dialog, and a non-modal dialog that can be moved and resized ([contract](design/contracts/dialog.contract.json))
- `color-picker` — A color picker that edits sRGB, Display-P3, and alpha using a two-axis color area, hue ring, and native range ([contract](design/contracts/color-picker.contract.json))
- `disclosure` — A disclosure that uses native `<details>/<summary>` and supports accordion groups via the `name` attribute ([contract](design/contracts/disclosure.contract.json))
- `dropdown-menu` — An action menu following the WAI-ARIA APG Menu Button Pattern ([contract](design/contracts/dropdown-menu.contract.json))
- `combobox` — An editable combobox with a listbox popup and single or multiple selection ([contract](design/contracts/combobox.contract.json))
- `toast` — A toast using WAI-ARIA Status Messages and a user-provided live region ([contract](design/contracts/toast.contract.json))
- `listbox` — A permanently visible listbox following the WAI-ARIA APG Listbox Pattern ([contract](design/contracts/listbox.contract.json))
- `list-reorder` — A controller that preserves native lists and reorders existing items via drag-and-drop, keyboard operations, and move up/down buttons ([contract](design/contracts/list-reorder.contract.json))
- `tooltip` — A tooltip displayed when hovering over or focusing on a user-provided trigger ([contract](design/contracts/tooltip.contract.json))
- `toolbar` — WAI-ARIA APG Toolbar Pattern ([contract](design/contracts/toolbar.contract.json))
- `toggle-group` — Single or multiple selection for a group of toggle buttons ([contract](design/contracts/toggle-group.contract.json))
- `accordion` — An accordion that opens and closes panels per heading according to the APG Accordion Pattern ([contract](design/contracts/accordion.contract.json))
- `avatar` — A headless avatar that synchronizes the loading state of a native image with fallback display/accessible names and root state outputs ([contract](design/contracts/avatar.contract.json))
- `slider` — A slider that adds state outputs and a cancelable change event to one or two native `input[type=range]` elements. Selects a range when using two inputs ([contract](design/contracts/slider.contract.json))
- `clipboard` — A copy trigger that writes to the Async Clipboard API ([contract](design/contracts/clipboard.contract.json))
- `carousel` — A carousel that switches slides following the APG Carousel Pattern and displays the next slide at set intervals ([contract](design/contracts/carousel.contract.json))
- `splitter` — A boundary between two areas following the APG Window Splitter Pattern (the pattern review by the task force is pending) ([contract](design/contracts/splitter.contract.json))
- `tree` — A hierarchical list following the APG Tree View Pattern. Virtual focus using aria-activedescendant ([contract](design/contracts/tree.contract.json))
- `grid` — Two-dimensional keyboard navigation for native `<table>` elements following the APG Grid Pattern ([contract](design/contracts/grid.contract.json))
- `image-cropper` — An image cropper that operates selection rectangle movement/resizing and image zoom using native controls ([contract](design/contracts/image-cropper.contract.json))
- `landmark-navigation` — Navigation that moves between semantic landmarks using F6 / Shift+F6 ([contract](design/contracts/landmark-navigation.contract.json))
- `table-of-contents` — Current position tracking for in-page table of contents ([contract](design/contracts/table-of-contents.contract.json))
- `timer` — Timekeeping corrected by time differences and milestone notifications ([contract](design/contracts/timer.contract.json))
- `editable` — Switching between display and edit modes, committing, and canceling ([contract](design/contracts/editable.contract.json))
- `table-sort` — Sorting requests using column headers of a native `<table>`. Follows the structure of the Sortable Table Example while keeping native roles ([contract](design/contracts/table-sort.contract.json))
- `number-field` — A number field that adds PageUp / PageDown and a cancelable change event to native `input[type=number]` ([contract](design/contracts/number-field.contract.json))
- `date-field` — A date field that adds a cancelable change event and state output to native `input[type=date]` ([contract](design/contracts/date-field.contract.json))
- `time-field` — A time field that adds a cancelable change event and state output to native `input[type=time]` ([contract](design/contracts/time-field.contract.json))
- `treegrid` — A format of the WAI-ARIA APG Treegrid Pattern where only cells receive focus. Adds two-dimensional focus navigation and row expanding/collapsing to hierarchical native `<table>` elements ([contract](design/contracts/treegrid.contract.json))
- `file-drop` — A drop zone that adds file drag-and-drop and dragover state output to native `input[type=file]` ([contract](design/contracts/file-drop.contract.json))
- `table-select` — Adds tri-state synchronization of a master checkbox, Shift range selection, and a cancelable change event to row selection checkboxes in a native `<table>` ([contract](design/contracts/table-select.contract.json))
- `calendar` — A calendar that adds single or range date selection and focus navigation via roving tabindex to a user-rendered month grid ([contract](design/contracts/calendar.contract.json))
- `character-count` — A character count that outputs `input` / `textarea` length and valid upper limits via CSS-readable custom properties, and outputs limit exceeding via `data-state` ([contract](design/contracts/character-count.contract.json))
- `tag-input` — A tag input that adds keyboard interactions and processing for add/remove events to free-form input or an existing chip list without an input field ([contract](design/contracts/tag-input.contract.json))
- `checkbox-group` — Adds tri-state synchronization of a master checkbox and a cancelable change event to checkboxes in any list ([contract](design/contracts/checkbox-group.contract.json))
- `hover-card` — A preview that opens on hover or focus of a link/button, allowing internal interactions ([contract](design/contracts/hover-card.contract.json))

## CSS

States are read from `data-*` attributes via CSS. For example, the visual appearance of an open disclosure is defined in the user's CSS.

```css
.faq-item[data-state="open"] {
  border-color: var(--accent-color);
}
```

**Please scope selectors with the user-side classes or elements.** Because `data-state` uses identical values (such as `open`, `min`, `max`) across multiple components, failing to scope it will cause styles to apply to unintended components.

Continuous values are output via custom properties. They can be used in CSS calculations.

```css
.count-bar {
  width: calc(100% * var(--character-count-value) / var(--character-count-max));
}
```

## License

[MIT](LICENSE).
