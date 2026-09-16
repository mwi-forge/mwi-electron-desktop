## Purpose

The mwi-electron-desktop application exposes a locale-switchable translation infrastructure so that future changes can extract UI strings progressively per module without re-architecting. This change introduces only the infrastructure (locale tables, translation lookup with fallback, locale persistence, DOM lang sync, settings UI entry), not the full string extraction itself.

## ADDED Requirements

### Requirement: Locale table loading
The system MUST load two locale tables from `<resource>/locales/{zh-CN,en-US}.json` at startup. Each table MUST be a JSON object mapping string keys to string values. The system MUST NOT crash if a table file is missing or malformed; the missing/malformed locale falls back to an empty in-memory table while other locales remain functional.

#### Scenario: Bootstrap loads both tables
- **WHEN** the renderer process initializes
- **THEN** both locale tables are available for translation lookup

#### Scenario: Missing or malformed table file
- **WHEN** a locale table file is absent or fails to JSON-parse
- **THEN** the application continues; the missing table is treated as empty; other locales still resolve correctly

### Requirement: Translation lookup with fallback chain and variable interpolation
The system MUST provide a translation function that accepts a key and an optional variables object. It MUST look up the key in the current locale table; on miss it MUST fall back to the zh-CN table; on a second miss it MUST return the key string itself. The system MUST resolve variables of the form `{name}` in the returned string by replacing each occurrence with the corresponding value from the supplied variables map.

#### Scenario: Key present in current locale
- **WHEN** the translation function is called with a key that exists in the current locale table
- **THEN** the value from the current locale table is returned unchanged

#### Scenario: Key missing in current locale but present in zh-CN
- **WHEN** the key is not in the current locale but exists in zh-CN
- **THEN** the zh-CN value is returned

#### Scenario: Key missing in both tables
- **WHEN** the key is absent from both locale tables
- **THEN** the key string itself is returned (the application MUST NOT throw)

#### Scenario: Variable interpolation
- **WHEN** the resolved translation string contains `{name}` placeholders and the variables map supplies matching keys
- **THEN** each `{name}` placeholder is replaced with its value from the variables map

### Requirement: Locale switching synchronizes the DOM language
The system MUST expose a locale-switching entry point that accepts a locale identifier (`zh-CN` or `en-US`), updates the in-memory current locale, and synchronizes the value of `document.documentElement.lang` to match. The system MUST reject unsupported locale identifiers by falling back to `zh-CN`. The system MUST notify all subscribers registered through an on-change subscription of the new locale identifier.

#### Scenario: Switch to en-US
- **WHEN** the locale is switched to `en-US`
- **THEN** the in-memory current locale becomes `en-US` AND `document.documentElement.lang === 'en-US'`

#### Scenario: Switch to zh-CN
- **WHEN** the locale is switched to `zh-CN`
- **THEN** the in-memory current locale becomes `zh-CN` AND `document.documentElement.lang === 'zh-CN'`

#### Scenario: Unsupported locale identifier
- **WHEN** the locale is switched to an identifier not in the supported list
- **THEN** the effective locale is `zh-CN` AND the application does not throw

#### Scenario: Locale change notifies subscribers
- **WHEN** the current locale changes via the switching entry point
- **THEN** every previously registered on-change subscriber receives a callback carrying the new locale identifier

### Requirement: Locale persistence across restarts
The system MUST persist the user-selected locale via electron-store `settings.locale`. On startup the persisted value MUST be read and applied as the initial current locale. If no persisted value exists, or if reading or writing the persistence layer fails, the system MUST fall back to `zh-CN` without crashing or showing an error modal.

#### Scenario: Round-trip persistence
- **WHEN** the user selects `en-US` and the application is restarted
- **THEN** the renderer process's initial current locale is `en-US`

#### Scenario: First run with no persisted value
- **WHEN** electron-store has no `settings.locale` field
- **THEN** the renderer process's initial current locale is `zh-CN`

#### Scenario: Persistence layer failure
- **WHEN** reading or writing electron-store fails for the locale field
- **THEN** the in-memory locale remains in its previous state AND the application continues without throwing or surfacing a modal

### Requirement: IPC surface for locale control
The main process MUST expose an IPC surface reachable from the renderer with three methods: `get`, `set(localeId)`, and `list`. `get` MUST return the persisted locale string. `set` MUST persist the supplied identifier and update the renderer process's in-memory locale. `list` MUST return the array `['zh-CN', 'en-US']`. These methods MUST NOT alter any other state.

#### Scenario: get returns the persisted locale
- **WHEN** the renderer calls IPC to read the current locale
- **THEN** the persisted locale string is returned

#### Scenario: set persists and applies
- **WHEN** the renderer calls IPC `set('en-US')`
- **THEN** electron-store `settings.locale` is set to `'en-US'` AND the renderer process's in-memory locale becomes `en-US` AND `document.documentElement.lang` reflects `en-US`

#### Scenario: list returns supported locales
- **WHEN** the renderer calls IPC for the supported locale list
- **THEN** the array `['zh-CN', 'en-US']` is returned (no other locales)

### Requirement: Settings tab provides a language picker
The renderer MUST register a static "settings" tab in the tabbar (following the same static-tab pattern documented by the archived `account-form` change). The settings tab MUST contain a language picker UI exposing the supported locales. The picker MUST reflect the current locale and persist the user's selection on change.

#### Scenario: Settings tab is visible in the tabbar
- **WHEN** the renderer loads
- **THEN** a "settings" tab is present in the tabbar alongside account-form and game tabs

#### Scenario: Picking a language updates locale and DOM
- **WHEN** the user chooses a language in the picker
- **THEN** the in-memory locale updates AND `document.documentElement.lang` reflects the new value AND the choice is persisted
