# AnonyProof Design System

## Product Direction

AnonyProof is an operational submission and follow-up tool, not a marketing site. The primary flow is:

1. choose a submission type;
2. describe verifiable facts and remove identifying details;
3. receive a record number and follow the handling status in the same browser.

The interface uses the visual lineage of "Ever New" without reusing its identity assets. The product remains serious, calm, privacy-aware, and task-first.

## Visual Contract

- Canvas: cold white `#F9FBFF`; secondary canvas `#EEF3FF`.
- Text: primary `#1A2133`; secondary `#657087`.
- Primary action and focus: cobalt `#315EFB`.
- Semantic colors only: mint for success, sun yellow for pending or caution, coral for errors.
- Geometry: 8px controls, 10px buttons, 12px panels. Avoid decorative pills except status badges.
- Surfaces: use alignment and 1px keylines first. Cards are reserved for bounded tools or repeated records.
- Type: system CJK sans stack, letter spacing `0`, 14-16px body text, restrained page headings.
- Motion: 160-220ms feedback only. Honor `prefers-reduced-motion`.

## Interaction Rules

- All touch targets are at least 44px.
- Desktop uses the fixed top navigation. Mobile uses a fixed bottom navigation with content clearance.
- Inputs always have visible labels, focus rings, disabled states, and preserved content after request failures.
- Async records distinguish loading, empty, filtered-empty, error, and retry states.
- Success confirmation remains until the user chooses the next action and exposes the record number.
- Privacy and legal boundaries appear before submission, not after it.

## Content Rules

- Use: submission, clue, submitted material, handling status, handling note, conversation, local browser identifier.
- Do not claim complete anonymity, end-to-end encryption, zero data leakage, or legal evidentiary effect.
- State actual storage and tracking behavior near the decision point.
- Errors explain what happened in user language and offer a recovery action. Do not expose parser or network internals.

## Responsive Acceptance

Verify at 375, 768, 1024, and 1440 CSS pixels:

- no horizontal overflow or clipped controls;
- mobile notification panel stays within 12px side margins;
- bottom navigation remains 12px above the viewport edge;
- forms reflow to one column and keep 48px primary actions;
- filters reflow from three columns to two and then one;
- footer content clears the mobile navigation.

## Do Not

- Do not reuse the "Ever New" logo, wordmark, particle animation, or portfolio hero treatment.
- Do not reintroduce purple gradients, emoji as UI controls, nested cards, or decorative glass everywhere.
- Do not use color as the only status signal.
- Do not hide privacy limits in tooltips, footers, or post-submit screens.
