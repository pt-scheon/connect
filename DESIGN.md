# Connect design system: the signed ledger

Connect records who built what and who signed it. The interface looks like that record: paper, ink, square forms and a stamp.

## Color (roles, light / dark)
| Role | Light | Dark |
| --- | --- | --- |
| Ground (`--bg`) | #eef0ea | #0d1410 |
| Surface (`--surface`) | #fbfbf8 | #141c17 |
| Sunk, chips, tracks (`--sunk`) | #e6e9e1 | #1b251f |
| Ink (`--ink`) | #111c16 | #eaf0e9 |
| Muted text (`--muted`) | #56635b | #9aa79f |
| Lines (`--line`, `--line2`) | #d6dbd0, #bcc4b6 | #26332b, #3a4a40 |
| Accent, actions and the closing field (`--accent`) | #c8380a | #ff6b3d |
| Signed / shipped (`--ok`) | #17704a | #4fd08a |
| Warning, error | #8a5a00, #b3261e | #f2b03d, #ff7468 |
| Inverted band (`--inv`) | #12201a | #18241d |

Ship orange is the orange square in the logo. Green means signed or shipped and nothing else. Muted text is at least 5:1 on the ground.

## Type
- Display: Bricolage Grotesque Variable, weights 700 and 800, tracking -0.025 to -0.05em, leading 0.92 to 1.1.
- Text: Instrument Sans Variable, 16px, leading 1.5.
- Numbers use tabular figures. Code is the only monospace.

## Shape and depth
- Radii: 6px (controls, avatars, chips), 8px (buttons, inputs), 12px (cards), 16px (the home calculator).
- Nothing at rest has a shadow. Surfaces separate by tone and one 1px line. Menus and toasts float and carry the only shadows.
- One stamp device: a rotated, double-outlined mark for anything signed (`.stamp`, `.pill.shipped`, `.pub-mark.ok`).

## Components
- Header: solid bar, two-square wordmark, text tabs with a 3px accent underline on the current page. On phones a five-tab bar sits at the bottom.
- Buttons: filled accent, ghost (1px inset line), danger. 8px radius, 40px high (50px large), `scale(.97)` on press.
- Filters and choices: square toggles, ink fill when on.
- Project cards: tone surface, monogram square, status pill, ink progress bar. Shipped projects carry the stamp.
- Credit balance: an ink tag with paper text.

## Motion
One authored moment: the "Shipped and signed" stamp lands on the home page (420ms, ease-out, delayed 500ms). Everything else is feedback: 120ms colour changes, 160ms press. Reduced motion removes all of it.

## Home page argument
1. The claim and a live calculator ("Try to game it").
2. How credit is earned: four numbered steps.
3. Two records side by side on an inverted band.
4. Who it is for, as four plain entries.
5. The close, on a flat field of the accent.
