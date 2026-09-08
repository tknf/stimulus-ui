# Do not add an angle configuration to slider

Use the existing slider when users need to choose an angle as a number, and do not add a configuration that drags around a circle. The unit of the value alone does not require new behavior. Use cases requiring circular dragging are unverified, and there is insufficient basis for separate input handling from the native range just for that operation.

## What the existing slider can handle

The [slider contract](../../design/contracts/slider.contract.json) provides the value range and increments from the native range's min / max / step, keyboard behavior, form submission, and cancelable change notifications. For example, 0–360 degrees can be represented with min=0 and max=360. Native range value and boundary rules follow the [HTML Standard](<https://html.spec.whatwg.org/multipage/input.html#range-state-(type=range)>).

The `--slider-value` emitted by a single slider on its root is a normalized value from 0 to 1, not the angle itself. To apply 0–360 degrees to a rotation, user CSS can use `rotate: calc(var(--slider-value) * 1turn)`. For an arbitrary range, the user converts it according to its min and max. The user owns the displayed element and appearance; the controller does not need rotation handling or an angle-specific custom property.

This is a configuration that selects an angle with a linear range; it does not implement an alternative to circular dragging.

## Difference from circular direct manipulation

Ark UI's [Angle Slider](https://ark-ui.com/docs/components/angle-slider) is a component that selects a value from a circular range, with a Control, Thumb, HiddenInput, and CSS output for the angle. Adding this behavior would require defining how to calculate an angle from pointer coordinates, how to handle values at the circle's center and boundary, and how to start, interrupt, and commit a drag. It cannot be provided by merely making the existing slider's CSS circular.

If the role remains slider, treat it as a configuration difference of the existing slider when reconsidering it. It is not a reason to create a separate angle-slider controller.

## Conditions for reconsideration

Consider extending the contract when a concrete use case satisfies the following conditions.

- The rotating target must be manipulated directly, and there is a reason a linear range that selects an angle is insufficient.
- It is possible to decide whether to stop or wrap at the 0-degree/360-degree boundary, whether to allow multiple rotations, and what increment and direction to use.
- It is possible to define paths to the same value with both keyboard input and a click or tap that does not drag.
- Responsibility for focus, announcements, and form submission can be decided, including whether to retain a native range as the interaction entry point.

Until the conditions specific to circular dragging are decided, do not add public API merely because the value uses an angle unit. Interaction and announcements for a circular widget on real devices are unverified; this decision does not establish that its accessibility is better or worse.
