# Shared code of the client

What every area of the app uses. It may not import from `features/` or `staff/` (`npm run deps`).

| What | Where |
|---|---|
| **Design system** | `ui/` (see its README) |
| **Tokens and base styles** | `tokens.css`: every colour, the type and spacing scales, corners and motion; the dark theme and the light theme |
| **The document** | `document.tsx` builds the client for an entry: its API client, query cache, router and the shell |
| **The shell** | `Shell.tsx`, `shell.module.css`: the header, the phone tab bar, the footer; `ThemeSwitch.tsx`, `ThemeSwitch.stories.tsx` |
| **The API** | `api.ts` (the client and its errors), `errors.ts`, `problems.ts` (the problem documents), `query.ts` (how fresh each kind of data is), `me.ts` |
| **Session and step-up** | `session.ts` (a session that ended), `stepUp.ts`, `StepUpDialog.tsx` (asking again before a sensitive action) |
| **Language** | `language/`: the catalogues' types, `Language.tsx`, the Bangla figures font, and the test that keeps `en` and `bn` in step |
| **Forms** | `form.tsx`: the app's forms on the primitives (text field, one-time code, password with an eye, checkbox, error summary, form message, submit button); `DateField.tsx` |
| **Popups** | `Popup.tsx`, `ConfirmDialog.tsx`: the primitives plus the one app behaviour (hidden while the step-up code is asked) |
| **Live** | `live.ts`: the socket; the connection renews its token with any request |
| **Money and time on screen** | `countdown.ts`, `clock.ts` (the server's clock), `lib/money.js`, `lib/time.js` |

A new component does not go here as a page-style one-off: it goes in `ui/`.
