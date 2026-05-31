---
name: groupwallet-frontend-standards
description: GroupWallet standard practices for Vanilla JS security, XSS prevention, and streamlined DOM manipulation. Use this skill when creating new frontend files, reviewing PRs, or modifying DOM injections.
license: MIT
author: GroupWalletWeb Team
version: "1.0.0"
---

# GroupWallet Frontend Standards

Comprehensive security and structure guide for Vanilla JS DOM manipulation within the GroupWallet app. Follow these rules to prevent XSS (Cross-Site Scripting), manage authentication securely, and maintain a clean architecture.

## When to Apply

- Creating new `.html` and `.js` files in the `Frontend/` folder.
- Injecting data from the database into the DOM using `innerHTML` or template literals.
- Setting up authentication checks for new private routes.

## Core Verifications & Streamline

1. **Escape HTML**: Never trust user data. Always wrap dynamic variables with the `escapeHTML` utility function before using `innerHTML`.
2. **Auth Verification**: Ensure `usuarioId` is checked at the top of every protected JS file and the user is booted out if absent.
3. **Global Fetch Interceptor**: Always implement the standard `window.fetch` interceptor to handle 401 Unauthorized responses seamlessly across all API calls.

## References

- `references/xss-prevention.md` (How to apply DOM security)
- `references/auth-streamline.md` (How to setup a protected file)