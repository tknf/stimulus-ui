# Do not create a split authentication-code input

Do not create a component that enters an authentication code (such as an SMS one-time code) in multiple `<input>` elements split one digit at a time. The referenced specifications, public design systems, and implementations use a single input. A controller supporting split DOM would provide markup that makes both accessibility and autofill harder to use.

## Rationale

1. **A single native input already provides all behavior.** Entry, paste, IME, `maxlength`, and SMS autofill (`autocomplete="one-time-code"`) work with one `<input>`. The WHATWG HTML Standard defines `one-time-code` as an autofill value for a single field, so split inputs are outside the specification. Without splitting, the focus movement and paste distribution that a controller would add are unnecessary.
2. **Primary sources choose a single input.** GOV.UK Design System's "Confirm a phone number" uses a single input + `govuk-input--extra-letter-spacing` in production and does not use split inputs. The APG has no OTP or split-input pattern (confirmed in the full pattern list). The input-otp adopted by shadcn also renders only one real input because "Screen readers — one control, one name, one value, one caret, one tab stop" and implements splitting at the styling layer.
3. **CSS handles the split appearance, and this library has no appearance.** `letter-spacing` with a monospaced font and `linear-gradient` can draw digit boxes. The only value needed by JavaScript for the appearance (the current input position = the value length) is already available as `--character-count-value` from character-count. An otp-field controller adds no unique function.

## Guidance

- For authentication-code entry, direct users to a single native `<input autocomplete="one-time-code" inputmode="numeric">` (the same shape as the GOV.UK pattern). Permissive parsing that accepts spaces or hyphens is the responsibility of the server or user JavaScript.
- Create an input that appears split into digits with user CSS (`letter-spacing`, gradient). Use character-count's custom property for value-dependent decoration such as digit highlighting.
- If Radix's `unstable_OneTimePasswordField` model (multiple visible inputs + a hidden input) is considered in the future, the first question is its conflict with the policy not to generate hidden inputs.

## Conditions for reconsideration

Reconsider when a TK&F product has a real requirement that a single input + CSS cannot satisfy (a requirement for split DOM) and the conditions are in place to test split DOM with screen readers on real devices (VoiceOver / NVDA).

## Items left unverified by the investigation

- The original WebKit blog post "Security Code AutoFill" (unverified because the link is broken). It has been confirmed that a Safari 15 blog post describes applying it only to a single input.
- An official statement on whether SMS autofill works with split inputs (not found; only the single-field assumption in the specification was confirmed).
- CSS `caret-shape` implementation status (only an article's "unsupported" statement, not a measurement). This concerns appearance and does not affect the decision.

## Primary sources

- WHATWG HTML Standard autofill (definition of one-time-code): https://html.spec.whatwg.org/multipage/form-control-infrastructure.html
- GOV.UK Design System "Confirm a phone number" (single input in production): https://design-system.service.gov.uk/patterns/confirm-a-phone-number/
- W3C ARIA APG pattern list (no OTP pattern): https://www.w3.org/WAI/ARIA/apg/patterns/
- input-otp (single transparent input + rendering slots): https://github.com/guilhermerodz/input-otp
- Radix `unstable_OneTimePasswordField` (experimental multiple-input approach): https://www.radix-ui.com/primitives/docs/components/one-time-password-field
- Single-input + CSS techniques: https://frontendmasters.com/blog/html-css-for-a-one-time-password-input/ , https://dev.to/madsstoumann/using-a-single-input-for-one-time-code-352l
