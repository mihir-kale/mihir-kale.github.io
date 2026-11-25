

# Media Archive Redesign — Implementation Instructions

Implement the following redesign in the existing media archive codebase.

Do not use external websites, external design references, or internet access. Do not introduce visual features or interactions not specified below.

Use the existing framework, build system, data source, and routing infrastructure. Modify the current implementation rather than creating a separate application.

## 1. Page Structure

Replace the existing media page layout with the following DOM hierarchy:

```
MediaPage
├── IndexPanel
│   ├── IndexHeader
│   ├── CategoryNavigation
│   └── IndexScrollArea
│       └── MediaEntry (repeated)
│           ├── MediaTitle
│           ├── Microreview
│           └── ReviewToggle
└── GalleryPanel
    └── GalleryScrollArea
        └── GalleryItem (repeated)
            └── CoverImage
```

Use a single shared collection of media objects to render both panels.

Do not duplicate the data into two independently managed collections.

## 2. Desktop Layout

Apply the following layout for viewport widths of at least 900px.

### Page container

```
.media-page {
  display: grid;
  grid-template-columns: 20% 80%;
  width: 100%;
  height: 100dvh;
  overflow: hidden;
  background: #faf9f6;
}
```

### Left panel

```
.index-panel {
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid #d8d8d4;
}
```

### Right panel

```
.gallery-panel {
  min-width: 0;
  height: 100%;
  overflow: hidden;
}
```

Both panels must have independently scrollable content.

Scrolling in either panel must not scroll the other panel except when selecting an item requires revealing its corresponding element.

Do not make the page body independently scrollable on desktop.

## 3. Left Panel — Header

The header contains the text:

`MEDIA`

Style:

```
.index-header {
  flex-shrink: 0;
  padding: 24px 16px 16px;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 12px;
  font-weight: 700;
  line-height: 16px;
  letter-spacing: 0.08em;
  color: #171717;
}
```

Do not add a logo, hero section, subtitle, description, or decorative element.

## 4. Category Navigation

Preserve existing media categories from the current data source.

Display category navigation directly below the header.

Requirements:

- Include an `ALL` option before the existing categories.
- Render categories as plain text controls.
- Use uppercase labels.
- Arrange controls in a wrapping horizontal row.
- Use an 8px horizontal gap and 6px vertical gap.
- Active category: `#171717`, font-weight 700.
- Inactive category: `#777777`, font-weight 400.
- Font: Arial, 10px.
- Line-height: 14px.
- No background fills, pills, cards, or rounded borders.
- Bottom border: 1px solid `#e5e5e1`.
- Container padding: `0 16px 16px`.

Selecting a category must immediately filter both panels to the exact same collection.

Use each media item's existing category metadata. Do not infer categories from titles or reviews.

## 5. Left Panel — Scroll Area

```
.index-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
  overscroll-behavior: contain;
}
```

Use native browser scrolling.

Do not add pagination or infinite scrolling.

Render every matching media item.

Preserve the existing default item ordering. If the existing page has multiple ordering modes, preserve them.

## 6. Media Entry Structure

Every media entry must contain the title, review preview, and optional expansion control.

Use this structure:

```
Title of Work
Microreview containing no more than 30 words.
>>>
```

Each entry must follow these exact styles.

### Entry container

```
.media-entry {
  position: relative;
  padding: 0 0 18px;
  margin: 0 0 18px;
  border-bottom: 1px solid #e5e5e1;
}
```

Do not use card backgrounds, box shadows, or rounded borders.

### Title

```
.media-title {
  display: block;
  width: 100%;
  padding: 0;
  margin: 0 0 6px;
  border: 0;
  background: transparent;
  color: #171717;
  text-align: left;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  cursor: pointer;
  overflow-wrap: anywhere;
}
```

Titles must wrap naturally. Do not truncate them or use ellipses.

### Microreview

```
.media-review {
  margin: 0;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  color: #555555;
  overflow-wrap: anywhere;
}
```

### Review toggle

```
.review-toggle {
  display: inline-block;
  padding: 0;
  margin-top: 5px;
  border: 0;
  background: transparent;
  color: #171717;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 11px;
  font-weight: 700;
  line-height: 16px;
  cursor: pointer;
}
```

Use exactly `>>>` for expansion and `<<<` for collapse.

Do not replace these with arrow icons or words.

## 7. Microreview Logic

Use each item's existing full review field.

Do not create, summarize, rewrite, or generate review text.

Implement preview generation as follows:

1. Read the existing review string.
2. Trim leading and trailing whitespace.
3. Split the string using whitespace as the word separator.
4. Take the first 30 words.
5. Join those words with single spaces.
6. If the review has more than 30 words, append `…` to the preview.
7. Otherwise display the entire review without an expansion control.

For reviews longer than 30 words:

- Default state: collapsed.
- Collapsed content: first 30 words plus `…`.
- Expanded content: entire original review.
- Collapsed control: `>>>`.
- Expanded control: `<<<`.

Do not truncate expanded reviews.

Do not truncate using character counts or CSS line clamping.

For empty, null, or missing reviews:

- Display only the title.
- Do not render the review paragraph.
- Do not render an expansion control.

### Expansion behavior

Clicking `>>>` must:

1. Select the corresponding media item.
2. Replace the preview with the full review.
3. Change the toggle to `<<<`.
4. Leave the current index scroll position unchanged unless the expanded control would otherwise move outside the visible area.
5. Leave the gallery at its current scroll position unless the selected artwork is not visible.

Clicking `<<<` must:

1. Collapse the full review.
2. Restore the 30-word preview.
3. Change the toggle to `>>>`.
4. Preserve the currently selected media item.

Only one review may be expanded at a time.

Expanding a second review must automatically collapse the first.

Clicking a title or artwork must not expand the review.

## 8. Right Panel — Gallery

The gallery occupies the entire right panel.

```
.gallery-scroll {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  overscroll-behavior: contain;
}
```

Display actual cover artwork from the existing media data.

Do not generate new images.

Do not add titles, authors, dates, captions, category labels, or review text below gallery images.

Do not add background cards around artwork.

### Gallery columns

Use a masonry-style layout with these exact column counts, based on the width of the gallery container:

| Gallery width    | Columns |
| ---------------- | ------- |
| 0–399px          | 2       |
| 400–699px        | 3       |
| 700–1099px       | 4       |
| 1100px and above | 5       |

Column gap: `12px`.

Vertical gap between adjacent artworks: `12px`.

All artwork in a column must occupy that column's available width, with its natural aspect ratio preserved.

Do not assign a common image height.

Do not crop images.

Do not use `object-fit: cover`.

### Deterministic masonry placement

Implement masonry using separate column containers.

For each item in the filtered dataset:

1. Determine the image aspect ratio from existing metadata, or from the loaded image's intrinsic dimensions.
2. Calculate estimated rendered image height using the current column width.
3. Place the item in the column with the smallest accumulated estimated height.
4. If multiple columns have equal height, choose the leftmost column.
5. Increase that column's accumulated height by the image height plus 12px.
6. Continue until all items are placed.

Recalculate column assignments when gallery width crosses a column-count breakpoint or changes enough to alter column width.

Do not randomize artwork placement.

Do not reorder the underlying dataset.

Do not rebuild column assignments merely because a different item is selected.

When dimensions are initially unknown, use a temporary aspect ratio of `2/3`. Recalculate placement once intrinsic image dimensions are available, batching dimension updates so that images do not repeatedly rearrange individually.

### Image rendering

```
.cover-image {
  display: block;
  width: 100%;
  height: auto;
  object-fit: contain;
}
```

Use image lazy loading.

Use `decoding="async"`.

Provide image alt text containing the media title.

For missing or failed images, render a placeholder with a `2/3` aspect ratio, background `#e8e6e0`, and the title in centered 12px text.

The placeholder must remain interactive and linked to the corresponding index entry.

## 9. Shared Selection State

Implement a single state variable:

```
selectedMediaId: string | null
```

Initial value: `null`.

All media items must be referenced by stable IDs from the existing data.

If an existing item has no ID, generate a deterministic ID from its existing stable record identifier or another persistent unique field. Do not use array indexes.

Selection must be mutually exclusive.

At most one media item may be selected at a time.

### Selected index entry styling

Apply:

```
.media-entry[data-selected="true"] .media-title {
  font-weight: 700;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}
```

No colored background.

No left-side colored bar.

### Selected artwork styling

Apply:

```
.gallery-item[data-selected="true"] {
  outline: 2px solid #171717;
  outline-offset: 3px;
}
```

The outline must surround the artwork's complete rectangular bounds.

It must not modify image dimensions or shift adjacent gallery items.

Do not apply an opacity reduction to the selected artwork.

### Unselected styling

Unselected entries and artworks retain their default styling.

Do not dim every unselected artwork.

## 10. Click Synchronization

### Clicking a title

When a title is clicked:

1. Set `selectedMediaId` to the clicked item's ID.
2. Apply selected index styling.
3. Apply the outline to the corresponding gallery item.
4. Check whether the gallery item is completely visible within the gallery scroll container.
5. If it is already completely visible, do not scroll.
6. If it is not completely visible, scroll the gallery to position the artwork's top edge 20px below the gallery viewport's top edge.
7. Do not alter review expansion state.

Use smooth scrolling unless reduced-motion is enabled.

### Clicking artwork

When artwork is clicked:

1. Set `selectedMediaId` to the clicked item's ID.
2. Apply the artwork outline.
3. Apply the selected index styling.
4. Check whether the corresponding entry is completely visible within the index scroll container.
5. If it is already completely visible, do not scroll.
6. Otherwise, scroll the index so the entry's title is positioned 16px below the index scroll container's top edge.
7. Do not alter review expansion state.

For an expanded review taller than the index viewport, visibility checks should use the entry title as the target rather than requiring the entire entry to fit.

### Selection updates

- Clicking the already selected item leaves it selected.
- Clicking a different item transfers selection.
- Do not toggle selection off on a second click.
- Do not change selection from manual scrolling alone.
- Do not automatically select the first media item.
- Do not expand a review in response to selecting an item.

Use refs or stable DOM IDs to locate corresponding items.

Never match an index entry to artwork using displayed title strings.

## 11. Hover Behavior

### Index title hover

On hover:

```
.media-title:hover {
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}
```

Hovering over an index entry must not change `selectedMediaId`.

### Artwork hover

```
.gallery-item {
  cursor: pointer;
  transition: outline-color 120ms ease;
}

.gallery-item:hover:not([data-selected="true"]) {
  outline: 1px solid #777777;
  outline-offset: 3px;
}
```

No artwork scaling.

No image zoom.

No blur.

No opacity changes.

No colored overlay.

No hover tooltip.

No automatic scrolling on hover.

## 12. Filtering Behavior

Both panels must always display the same filtered collection.

When a user changes categories:

1. Update the active category.
2. Calculate the filtered media collection.
3. Render only that collection in both panels.
4. Reset both scroll containers to `scrollTop = 0`.
5. Clear `selectedMediaId` if the selected item is excluded by the filter.
6. Collapse an expanded review if its item is excluded.
7. Recalculate masonry placement for the filtered artwork.

If the selected item is still present, keep it selected.

Changing filters must not modify the stored data.

Preserve any existing search functionality.

Search must operate on the same collection as category filtering, and gallery results must always correspond exactly to the visible index entries.

If filtering produces no results, display `No works found.` in both panels.

## 13. Responsive Behavior

Use the following viewport breakpoints.

### Desktop: 900px and above

- Two-column layout.
- Left panel: 20%.
- Right panel: 80%.
- Independently scrollable panels.

### Tablet: 600px–899px

Change the main grid to:

```
grid-template-columns: 32% 68%;
```

Keep both panels visible and independently scrollable.

Keep the same typography, selection logic, and review functionality.

### Mobile: below 600px

Replace the simultaneous panels with a single-panel view.

At the top, render two text controls:

`INDEX` and `GALLERY`

Use the following state:

```
mobileView: "index" | "gallery"
```

Initial value: `"index"`.

Rules:

- Only one panel is visible at a time.
- Both panels use 100% viewport width.
- The mobile navigation occupies 44px of height.
- The active view control has a 2px solid bottom border.
- The inactive view control has no bottom border.
- View controls use 12px Arial, uppercase.
- Preserve selected item state across views.
- Preserve review expansion state across views.
- Do not discard panel DOM state when switching views.

When a user selects an index title on mobile, switch to Gallery view and reveal the corresponding selected artwork.

When a user selects artwork on mobile, switch to Index view and reveal the corresponding selected title.

Review toggle clicks must not switch views.

Mobile gallery uses the same column rules based on gallery container width.

## 14. Accessibility

Implement all of the following:

- Render clickable titles as `<button type="button">`.
- Render clickable gallery items as buttons.
- Render review toggles as buttons.
- Make category controls keyboard accessible.
- Give each gallery button an accessible name equal to the media title.
- Use `aria-expanded` on review toggles.
- Use `aria-controls` to associate each toggle with its full-review region.
- Use `aria-pressed` on selectable title and artwork buttons.
- Provide visible keyboard focus outlines.
- Preserve normal Tab navigation.
- Enter and Space must activate buttons using native button behavior.

Focus outline:

```
:focus-visible {
  outline: 2px solid #171717;
  outline-offset: 3px;
}
```

Respect `prefers-reduced-motion: reduce` by disabling smooth scroll and nonessential transitions.

Do not use non-semantic clickable `<div>` elements.

## 15. Data Preservation

Before editing the site, inspect the existing media data source and components.

Determine where the following fields currently reside:

- Unique item identifier
- Title
- Category
- Cover image URL
- Full review
- Existing display order

Create a normalization layer if necessary to expose these fields consistently.

Do not modify the database schema unless the existing schema makes the required functionality impossible.

Do not delete existing records.

Do not invent artwork URLs or review text.

Keep all existing data integrations functional.

Do not migrate content to a new backend.

Do not introduce external fonts.

Do not fetch fonts, images, or data from new third-party services.

Existing external artwork URLs may continue to be used.

## 16. Performance Requirements

- Lazy-load artwork.
- Avoid unnecessary rerenders of the entire gallery on selection changes.
- Memoize filtered collections and masonry column assignments where appropriate.
- Do not recompute masonry placement when expanding reviews.
- Avoid cumulative layout shifts after artwork dimensions are known.
- Use passive native scrolling rather than scroll-position polling.
- Do not install an animation library.
- Do not introduce a new global state-management library.
- Use the framework's existing state-management capabilities.

## 17. Features Not to Implement

Do not add any of the following:

- Hero section
- Landing-page introduction
- Profile photo
- Decorative background graphics
- Animated page transitions
- Artwork zoom on hover
- Artwork lightbox
- Modal review viewer
- Automatic carousel
- Randomized gallery layout
- Artwork captions
- Ratings or star icons
- Like buttons
- Social sharing controls
- Media cards
- Sorting controls not already present
- New review-writing functionality
- New content-management functionality
- New third-party services

## 18. Validation

Test the implementation at these viewport sizes:

- 1440 × 900
- 1280 × 800
- 1024 × 768
- 768 × 1024
- 390 × 844
- 375 × 667

### Required tests

1. At 1440px width, the left panel is exactly 288px and the right panel is 1152px.
2. At 1024px width, the left panel is 204.8px and the right panel is 819.2px.
3. At 768px width, the left panel occupies 32% and the right panel 68%.
4. At 390px width, only the active mobile view is visible.
5. Both desktop panels scroll independently.
6. Every index item maps to exactly one gallery item.
7. Every gallery item maps to exactly one index item.
8. Clicking any title highlights only its corresponding artwork.
9. Clicking any artwork highlights only its corresponding index entry.
10. Selection remains unchanged during ordinary manual scrolling.
11. Reviews display exactly the first 30 whitespace-delimited words when collapsed, followed by an ellipsis only if additional words exist.
12. Expansion displays the complete original review.
13. Expanding a different review collapses the previously expanded review.
14. Category filtering produces identical item IDs in both panels.
15. Artwork retains its natural aspect ratio.
16. No artwork is randomly rearranged when selection changes.
17. Missing artwork does not break index-to-gallery synchronization.
18. No horizontal page overflow occurs at any test width.
19. Keyboard navigation and review controls work.
20. Existing data-loading functionality continues to work.

## 19. Completion Requirements

Implement the redesign directly in the existing project.

Run the existing build and test commands.

Resolve all new build errors and TypeScript errors.

Do not remove existing tests simply to make the build pass.

At completion, provide:

1. List of modified files.
2. Summary of implemented functionality.
3. Test and build results.
4. Any requirement that could not be implemented, with the exact technical reason.

Do not substitute a plan, wireframe, mockup, or design document for implementation.

Do not ask for further design decisions. Apply the exact values and behavior defined above.
