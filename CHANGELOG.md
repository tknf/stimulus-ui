# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-09-26

### Added

- `editable`: `data-editable-commit-key-value` selects the save key for both field types. `enter` (default) saves with Enter, and `modifier-enter` saves with Control+Enter / Meta+Enter.

### Changed

- `editable`: With the default `enter` commit key, a textarea saves with Enter and inserts a newline with Shift+Enter. Control+Enter / Meta+Enter no longer save a textarea unless `modifier-enter` is set.

## [0.1.0] - 2026-09-08

First public release of `@tknf/stimulus-ui`.

### Added

- 38 headless Stimulus controllers with keyboard interaction, state synchronization, and component-specific ARIA behavior.
- Discrete state attributes, continuous CSS custom properties, and typed custom events for integration with consumer markup and styles.
- ES modules and TypeScript declarations, with Stimulus `^3.2.2` as the only runtime peer dependency.
- Component contracts defining public APIs, markup requirements, keyboard behavior, and accessibility verification status.
- MIT licensing and npm distribution.
