---
name: currency-formatting
description: Standard for formatting the Chilean Peso currency symbol across the application UI and messages.
license: MIT
author: GroupWalletWeb Team
version: "1.0.0"
---

# Chilean Peso (CLP) Formatting Standard

When displaying or referencing the Chilean Peso in the GroupWallet application, always use the combined symbol **`CLP$`**.

## Rule
Never use `CLP` alone without the peso sign, and never use `$` alone when specifically differentiating the Chilean currency from USD or generic pesos in the UI. The correct ISO-compliant format for UI display in this project is `CLP$`.

**Incorrect:**
- `CLP 5000`
- `5000 CLP`
- `$ 5000 CLP`

**Correct:**
- `CLP$5000`
- `CLP$ 5000.00`

### Important Exceptions
When interacting with third-party payment gateways (like MercadoPago's `preference.create`) or external APIs that require the strict 3-letter ISO 4217 code, you must continue to use the exact string `'CLP'` (e.g., `currency_id: 'CLP'`).