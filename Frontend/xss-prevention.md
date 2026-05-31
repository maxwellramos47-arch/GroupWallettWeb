---
title: Prevent XSS using escapeHTML before innerHTML injections
impact: CRITICAL
impactDescription: Prevents malicious scripts from executing in the browser
tags: xss, security, innerHTML, frontend, sanitization
---

## Prevent XSS using escapeHTML before innerHTML injections

Directly injecting database values or user inputs into `innerHTML` creates a severe Cross-Site Scripting (XSS) vulnerability.

**Incorrect (Direct Injection):**

```javascript
const tr = document.createElement('tr');
// VULNERABLE: If t.descripcion is "<img src=x onerror=alert('hack')>", it will execute!
tr.innerHTML = `<td>${t.descripcion}</td>`; 
```

**Correct (Using escapeHTML utility):**

```javascript
// 1. Always include the escapeHTML function at the top of your JS module:
const escapeHTML = (str) => {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
};

// 2. Wrap EVERY dynamic variable in escapeHTML:
const tr = document.createElement('tr');

// SAFE: HTML tags will be converted to text literals (e.g. &lt;img src=x&gt;)
tr.innerHTML = `
    <td>${escapeHTML(t.descripcion)}</td>
`;
```