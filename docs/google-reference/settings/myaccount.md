# Google Account Settings — Page Reference

> Captured from myaccount.google.com on 2026-06-08 using the pass-3 Playwright settings-walker.
> Source artifacts: `grown-workspace/research/gworkspace-frontend/pass3/myaccount_*/settings/`
>
> **Extraction method:** Navigated to each myaccount.google.com page, waited for render,
> extracted interactive elements from `[role="main"]`. Each page is a separate URL (no
> fragment navigation). Element counts reflect links + buttons captured.
>
> **Account context:** Captures were made with account `lucas@yield-llc.com` (throwaway
> account used for UI research). Personal data is visible in labels below — this is expected
> for documentation of UI structure, not a privacy concern (research-only account).

---

## Personal info page

**URL:** `https://myaccount.google.com/personal-info`

**Source:** `pass3/myaccount_personal/settings/personal-info.{html,json,png}` (12 elements, captured 2026-06-08)

| #   | Setting               | Notes                                                   |
| --- | --------------------- | ------------------------------------------------------- |
| 1   | Profile picture       | Button — change profile photo                           |
| 2   | Name & pronunciation  | Link — edit display name and name pronunciation         |
| 3   | Email                 | Link — view/manage associated email addresses           |
| 4   | Phone                 | Link — add/manage recovery phone number                 |
| 5   | Birthday              | Link — add/manage birthday                              |
| 6   | Language              | Link — display language (e.g., English (United States)) |
| 7   | Home address          | Link — set home address                                 |
| 8   | Work address          | Link — set work address                                 |
| 9   | Other addresses       | Link — manage additional addresses                      |
| 10  | Google Password       | Link — shows last changed date; opens password change   |
| 11  | Search Google Account | Button — search within Account settings                 |
| 12  | Get help              | Button — opens Help Center                              |

---

## Data and privacy page

**URL:** `https://myaccount.google.com/data-and-privacy`

**Source:** `pass3/myaccount_data/settings/data-and-privacy.{html,json,png}` (20 elements, captured 2026-06-08)

| #          | Setting                     | Current state | Notes                                        |
| ---------- | --------------------------- | ------------- | -------------------------------------------- |
| 1          | Privacy Checkup             | —             | Link — guided privacy review                 |
| 2          | Personalize Search          | On            | Link — toggle search personalization         |
| 3          | Web & App Activity          | Paused        | Link — controls activity tracking            |
| 4          | YouTube History             | Paused        | Link — controls YouTube watch/search history |
| 5          | Timeline                    | Paused        | Link — controls location history             |
| 6          | Learn more                  | —             | Link — Google Activity Controls help         |
| 7          | View My Activity            | —             | Link — myactivity.google.com                 |
| 8          | View YouTube History        | —             | Link — YouTube history page                  |
| 9          | View Maps Timeline          | —             | Link — Google Maps Timeline                  |
| 10         | My Ad Center                | Off           | Link — personalized ads settings             |
| 11         | Partner ads settings        | —             | Link — ads on partner sites                  |
| 12         | Third-party apps & services | —             | Link — manage app connections                |
| 13         | Google Fit privacy          | —             | Link — Fit data management                   |
| 14         | Voice Match                 | —             | Link — voice recognition settings            |
| 15         | Google Dashboard            | —             | Link — manage content across services        |
| (+ 5 more) | Additional privacy links    |               | Download data, delete account, etc.          |

---

## Security page

**URL:** `https://myaccount.google.com/security`

**Source:** `pass3/myaccount_security/settings/security.{html,json,png}` (24 elements, captured 2026-06-08)

| #          | Setting                       | Notes                                                |
| ---------- | ----------------------------- | ---------------------------------------------------- |
| 1          | Security recommendations      | Link — shows pending security actions                |
| 2          | Recent security activity      | Link — sign-in events (e.g., "New sign-in on Linux") |
| 3          | Review security activity      | Link — full security activity log                    |
| 4          | 2-Step Verification           | Link — enable/manage 2SV (currently: Off)            |
| 5          | Password                      | Link — change password (shows last changed date)     |
| 6          | Skip password when possible   | Link — passkey/biometric settings                    |
| 7          | Google prompt                 | Link — manage trusted devices (shows count)          |
| 8          | Recovery phone                | Link — add/verify recovery phone                     |
| 9          | Recovery email                | Link — verify backup email                           |
| 10         | Passkeys and security keys    | Link — manage hardware keys                          |
| 11         | Authenticator                 | Link — Google Authenticator TOTP setup               |
| 12         | 2-Step Verification phone     | Link — SMS/call 2SV setup                            |
| 13         | Active sessions — Linux       | Link — shows Linux computer sessions                 |
| 14         | Active sessions — iPhone      | Link — shows iPhone sessions                         |
| 15         | Active sessions — Mac         | Link — shows Mac sessions                            |
| (+ 9 more) | App passwords, other devices, | etc.                                                 |

---

## People and sharing page

**URL:** `https://myaccount.google.com/people-and-sharing`

**Source:** `pass3/myaccount_sharing/settings/people-and-sharing.{html,json,png}` (9 elements, captured 2026-06-08)

| #   | Setting                              | Current state    | Notes                                                  |
| --- | ------------------------------------ | ---------------- | ------------------------------------------------------ |
| 1   | Contacts                             | —                | Link — view/manage Google Contacts                     |
| 2   | Contact info saved from interactions | On               | Link — save contact details from emails                |
| 3   | Contact info from your devices       | Off              | Link — sync device contacts to Google                  |
| 4   | Blocked                              | No blocked users | Link — manage blocked users                            |
| 5   | Location sharing                     | Not sharing      | Link — real-time location sharing with others          |
| 6   | About me                             | —                | Link — control what personal info is visible to others |
| 7   | Your profiles                        | —                | Link — how your profiles appear in Google services     |
| 8   | Search Google Account                | —                | Button                                                 |
| 9   | Get help                             | —                | Button                                                 |

---

## Payments and subscriptions page

**URL:** `https://myaccount.google.com/payments-and-subscriptions`

**Source:** `pass3/myaccount_payments/settings/payments-and-subscriptions.{html,json,png}` (6 elements, captured 2026-06-08)

| #   | Setting                | Notes                                                          |
| --- | ---------------------- | -------------------------------------------------------------- |
| 1   | Manage payment methods | Link → payments.google.com                                     |
| 2   | Google Wallet settings | Link — manage Wallet data and privacy                          |
| 3   | Account storage        | Link — shared storage across Drive, Gmail, Photos              |
| 4   | Subscriptions          | Link — recurring subscription payments (news, streaming, etc.) |
| 5   | Search Google Account  | Button                                                         |
| 6   | Get help               | Button                                                         |
