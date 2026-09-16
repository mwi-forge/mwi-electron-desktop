# views-idle-autostop Specification

## Purpose
TBD - created by archiving change idle-auto-stop. Update Purpose after archive.
## Requirements
### Requirement: Per-account idle timer
The system MUST arm an idle timer per running view when the view starts. The timer MUST fire stopView(accountId, 'idle_timeout') after the configured idleAutoStopMs milliseconds of inactivity. If idleAutoStopMs is 0, the system MUST NOT arm any timer.

#### Scenario: Default timer armed on view start
- **WHEN** startView succeeds for an account and idleAutoStopMs is 300000 (default)
- **THEN** a timer is armed with remaining equal to 300000 minus elapsed time since lastActivityAt

#### Scenario: Disabled when idleAutoStopMs is 0
- **WHEN** startView succeeds and idleAutoStopMs is 0
- **THEN** no setTimeout is called and entry.idleTimer remains null

### Requirement: Activity sources reset timer
The system MUST treat the following events as user activity and reset the idle timer: webContents 'before-input-event' with input.type in {keyDown, mouseDown, mouseWheel}; webContents 'did-navigate'; webContents 'did-navigate-in-page' when isMainFrame is true; focusView switching to that account.

#### Scenario: Keyboard input resets timer
- **WHEN** the focused view's webContents emits before-input-event with input.type 'keyDown'
- **THEN** lastActivityAt is updated to Date.now() and the idle timer is re-armed with full idleAutoStopMs remaining

#### Scenario: Mouse click resets timer
- **WHEN** the focused view's webContents emits before-input-event with input.type 'mouseDown'
- **THEN** lastActivityAt is updated to Date.now() and the idle timer is re-armed

#### Scenario: Mouse wheel resets timer
- **WHEN** the focused view's webContents emits before-input-event with input.type 'mouseWheel'
- **THEN** lastActivityAt is updated to Date.now() and the idle timer is re-armed

#### Scenario: Navigation resets timer
- **WHEN** the view's webContents emits 'did-navigate'
- **THEN** lastActivityAt is updated to Date.now() and the idle timer is re-armed

#### Scenario: In-page navigation resets timer only when main frame
- **WHEN** the view's webContents emits 'did-navigate-in-page' with isMainFrame true
- **THEN** lastActivityAt is updated to Date.now() and the idle timer is re-armed
- **WHEN** the view's webContents emits 'did-navigate-in-page' with isMainFrame false (subframe)
- **THEN** lastActivityAt is NOT updated and the idle timer is not re-armed

#### Scenario: Focus switch resets timer for newly focused account
- **WHEN** focusView is called for accountId A while accountId B was previously focused
- **THEN** accountId A's lastActivityAt is updated to Date.now() and its idle timer is re-armed
- **AND** accountId B's timer is NOT reset by the focus change

### Requirement: Auto-stop on timeout
The system MUST call stopView(accountId, 'idle_timeout') when the idle timer fires. After stopView, the entry MUST be removed from the pool and the view's webContents MUST be destroyed.

#### Scenario: Timer fires after configured idle period
- **WHEN** an idle timer fires for accountId A
- **THEN** stopView(A, 'idle_timeout') is invoked
- **AND** the entry for A is removed from the pool
- **AND** the view's webContents is destroyed

### Requirement: State emission distinguishes idle stop
The system MUST emit state 'stopped:idle_timeout' when stopView is invoked with reason 'idle_timeout'. For all other reasons the system MUST emit 'stopped' (backward-compatible with existing renderer logic).

#### Scenario: idle_timeout reason produces idle state
- **WHEN** stopView(A, 'idle_timeout') is called
- **THEN** emitState(A, 'stopped:idle_timeout') is called

#### Scenario: user-initiated stop produces normal state
- **WHEN** stopView(A) is called without a reason argument (or with reason other than 'idle_timeout')
- **THEN** emitState(A, 'stopped') is called

### Requirement: Configurable timeout via IPC
The system MUST expose IPC handlers views:getIdleConfig and views:setIdleConfig. getIdleConfig MUST return { timeoutMs, enabled }. setIdleConfig MUST validate Number.isFinite(timeoutMs) and timeoutMs >= 0; invalid values MUST throw an Error. On valid set, the system MUST persist idleAutoStopMs via electron-store name 'views' (write failures are silently swallowed) and re-arm every currently running view's idle timer.

#### Scenario: Get returns current config
- **WHEN** renderer calls window.api.views.getIdleConfig() with idleAutoStopMs at default 300000
- **THEN** the IPC returns { timeoutMs: 300000, enabled: true }

#### Scenario: Set persists and propagates to running views
- **WHEN** renderer calls window.api.views.setIdleConfig({ timeoutMs: 60000 })
- **THEN** idleAutoStopMs in electron-store views.json becomes 60000
- **AND** every running view's idle timer is re-armed with the new value

#### Scenario: Set with invalid value throws
- **WHEN** renderer calls window.api.views.setIdleConfig({ timeoutMs: -1 })
- **THEN** the IPC handler throws Error('invalid timeoutMs')
- **AND** idleAutoStopMs is NOT changed

#### Scenario: Set with zero disables feature
- **WHEN** renderer calls window.api.views.setIdleConfig({ timeoutMs: 0 })
- **THEN** idleAutoStopMs becomes 0
- **AND** every running view's armIdleTimer becomes a no-op
- **AND** getIdleConfig returns { timeoutMs: 0, enabled: false }

### Requirement: App before-quit clears all timers
The system MUST clear all pending idle timers when the application emits 'before-quit'. The system MUST use clearTimeout on each entry.idleTimer and set entry.idleTimer to null.

#### Scenario: All timers cleared on quit
- **WHEN** app emits 'before-quit' with N running views each holding a timer handle
- **THEN** N clearTimeout calls are made
- **AND** every entry.idleTimer is set to null
- **AND** no setTimeout callback fires after quit

### Requirement: stopView clears the timer
The system MUST clear the idle timer when stopView is invoked (regardless of reason). The clear MUST happen before any other destructive operation in stopView.

#### Scenario: Manual stop clears timer
- **WHEN** stopView(A) is called while A has an active idle timer
- **THEN** the timer is cleared via clearTimeout before the view is destroyed

#### Scenario: Idle-fired stop is idempotent
- **WHEN** the idle timer fires and calls stopView(A, 'idle_timeout') and the entry is already removed from pool
- **THEN** stopView returns without throwing and no second destroy is performed

### Requirement: settings tab exposes idle configuration
The settings tab MUST include an idleAutoStop fieldset with a toggle input (enable/disable) and a numeric input (1 ~ 1440 minutes). On open, the tab MUST fetch the current config via window.api.views.getIdleConfig() and pre-fill the inputs. On submit, the tab MUST call window.api.views.setIdleConfig({ timeoutMs }) with enabled ? minutes * 60000 : 0. Locale strings MUST be loaded from src/locales/{zh-CN,en-US}.json under settings.idleAutoStop.{label,hint,value,disabled} and views.idleStopReason.

#### Scenario: Toggle off disables feature
- - **WHEN** user toggles the enable checkbox off and clicks save
- - **THEN** window.api.views.setIdleConfig({ timeoutMs: 0 }) is called
- - **AND** the next started account does not have any timer armed

#### Scenario: Numeric input persists minutes
- - **WHEN** user enters 10 minutes, toggle is on, and clicks save
- - **THEN** window.api.views.setIdleConfig({ timeoutMs: 600000 }) is called

### Requirement: tabbar surfaces idle_timeout state
The tabbar MUST render the tab with the existing 'stopped' status class when localStates.get(id) equals 'stopped:idle_timeout', and MUST attach a hover title attribute containing the localized views.idleStopReason string.

#### Scenario: Auto-stopped tab shows hint
- - **WHEN** account A's state becomes 'stopped:idle_timeout'
- - **THEN** A's tab in the tabbar has title='已被自动停止（空闲超时）' (or the en-US equivalent) and the status dot still uses the stopped class

