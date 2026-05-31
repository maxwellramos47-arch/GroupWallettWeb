---
title: Streamline Protected Routes Verification
impact: HIGH
impactDescription: Enforces consistent security and session handling across all pages
tags: auth, interceptor, session, frontend
---

## Streamline Protected Routes Verification

Every protected Vanilla JS file must implement an upfront token check and a global `fetch` interceptor to gracefully handle session expirations (401 Unauthorized) driven by HttpOnly cookies.

**Correct (Standard Boilerplate for new files):**

```javascript
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initial Protection (Frontend Level)
    const usuarioId = localStorage.getItem('usuarioId');
    if (!usuarioId) {
        window.location.href = 'login.html';
        return; 
    }
    const token = 'http-only-cookie'; // Legacy compatibility

    // 2. Global Fetch Interceptor
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        let [resource, config] = args;
        if (!config) config = {};
        config.credentials = 'same-origin'; // Force HttpOnly cookies to be sent

        const response = await originalFetch(resource, config);
        if (response.status === 401) {
            localStorage.removeItem('usuarioId');
            localStorage.removeItem('usuarioNombre');
            if (typeof showToast === 'function') showToast('Tu sesión ha expirado.', 'error');
            setTimeout(() => window.location.href = 'login.html', 2000);
            return Promise.reject(new Error('Sesión expirada'));
        }
        return response;
    };
});
```