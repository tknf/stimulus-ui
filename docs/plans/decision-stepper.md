# Do Not Create Stepper

We will not create a stepper component to represent multi-step progression, such as in wizards.

## Reasons

1. There is no specifiable standard. The APG pattern list does not define Stepper, Steps, or Wizard patterns. What WAI-ARIA 1.2 defines for steps is aria-current="step" (a state attribute), not a widget role. Writing a contract without a standard makes it impossible to verify acceptance criteria (the same judgment as decision-pagination.md).
2. It can be expressed with markup and existing components. The list of steps and the current position can be represented using <ol> + aria-current="step", and since these are static attributes, they work without JS intervention. When panel switching is required, tabs handle it. Linear progression control (such as only allowing progress up to completed steps) belongs to the application's validation logic, not the domain of this library.

## Guidance

- Guide users who need a step progression display to use <ol> + aria-current="step". Use tabs when panel switching is involved.

## Conditions for Reconsideration

When a pattern or role equivalent to a stepper is added to APG or WAI-ARIA.

## Primary Sources

- APG Pattern List (Source to confirm the absence of a stepper equivalent): https://www.w3.org/WAI/ARIA/apg/patterns/
- aria-current (Definition of values including "step"): https://www.w3.org/TR/wai-aria-1.2/#aria-current
