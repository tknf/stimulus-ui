# Do not add a range configuration to date-field and time-field

Use two existing fields for start and end, and validate their order in the user's form. With two fixed inputs, a small controller that compares their values and passes the result to the native Constraint Validation API is sufficient, so do not add range-specific API to date-field / time-field.

## Composition example

- [Markup](../../test/compositions/period_fields.html): Two forms for entering a date period and a same-day time period.
- [User controller](../../test/compositions/period_validation_controller.ts): Compare input numbers and update the end input's custom validity.
- [Browser test](../../test/period_fields_composition.test.ts): Verify entry, submission, reset, empty values, and equal values.

Each form handles two inputs of the same type. It does not rewrite values automatically and uses native validation to stop ordinary form submission while the order is reversed. It does not prevent re-entering the end after moving the start later. Each input's `required` determines whether it is required; the user markup provides instructions and error text.

The [Constraint Validation API](https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Constraint_validation#complex_constraints_using_the_constraint_validation_api) provides a way to calculate a condition across multiple fields in JavaScript and apply it to native validation with `setCustomValidity()`. This example manages the end input's custom validity alone. When composing it with other custom validation, the user combines the error decisions.

Compare with `valueAsNumber`. An empty input is not numeric, so remove the ordering error and leave missing-value validation to `required`. Treat time `10:00` and `10:00:00` as the same value. Receive input / change through Stimulus actions and validate after reset as well. When the public field API or native value is changed programmatically, the caller then calls `sync()`.

The example assumes two fixed valid inputs and a non-empty error message. It does not cover dynamic target replacement, inputs from different forms, or disabled / readonly combinations in which only one side is submitted. It is for evaluating composition complexity, not a distributed general-purpose controller.

## Why existing fields are not extended

date-field / time-field each use one native input as the root and delegate validation and correction of its value to the native control. Adding a wrapper that accepts two inputs is technically possible, but synchronizing their order alone does not require changing the existing field API.

The relationship between start and end does not always follow the same rule. The example chooses start≤end for dates and start≤end on the same day for times. [Native time supports a cyclic value range and can represent min / max across midnight](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/time#additional_attributes). Therefore, do not impose on all of time-field a rule that universally corrects an end time smaller than the start time as invalid. The user decides whether to allow equality, cross midnight, or combine dates and time zones.

[Melt UI's [Date Range Field](https://www.melt-ui.com/docs/builders/date-range-field) and [Bits UI's Time Range Field](https://bits-ui.com/docs/components/time-range-field) provide inputs with start and end segments. They do not have the same markup or focus behavior as the two native inputs tested here. Integrating segments and reimplementing locale-specific entry are outside the purpose of this composition.

## Conditions for reconsideration

Reconsider when concrete behavior is needed that user-side period validation cannot handle, such as coordinated focus between two inputs, a transaction that commits start and end together, or synchronization with a calendar. If the role does not change, treat it as a configuration difference of the existing fields and define a wrapper contract while preserving the one-input form.

## Verification

Run `vp run test run test/period_fields_composition.test.ts` to test seven cases each in Chromium / Firefox / WebKit. Verify submission blocking for reversed values, recovery after correcting either side, preservation of values and FormData, empty and equal values, reset cancellation and restoration, equivalent second notation for times, and no markup warnings.

Apply negative controls separately by removing order validation, replacing numeric comparison with string comparison, and moving reset revalidation from a task to a microtask; verify the corresponding tests fail in Chromium. Restore each change after testing.

Real-device interaction inside native pickers and screen-reader announcements of errors are unverified (observation). The existing fields' public specifications are unchanged, and real-device compatibility is not considered verified.
