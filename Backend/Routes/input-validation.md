---
title: Enforce Input Validation using Zod
impact: HIGH
impactDescription: Prevents DoS attacks, data corruption, and ensures type safety at the API boundary
tags: validation, zod, api, routes, security
---

## Enforce Input Validation using Zod

Never trust data coming from the client (`req.body`, `req.query`, or `req.params`). Always validate and sanitize inputs at the Route level using Zod before passing the data to the Business Logic Layer (BLL).

**Incorrect (Trusting input implicitly):**

```javascript
router.post('/gasto', async (req, res) => {
    // VULNERABLE: 'monto' could be a huge string or an object, causing server crashes
    const { descripcion, monto } = req.body; 
    await GastoBLL.crearGasto(descripcion, monto);
});
```

**Correct (Using Zod for strict validation):**

```javascript
const { z } = require('zod');

const gastoSchema = z.object({
    descripcion: z.string().min(1).max(255),
    monto: z.union([z.number(), z.string()]).transform(v => parseFloat(v)).refine(v => v > 0)
});

router.post('/gasto', async (req, res) => {
    const validacion = gastoSchema.safeParse(req.body);
    if (!validacion.success) {
        return res.status(400).json({ error: validacion.error.errors[0].message });
    }
    const { descripcion, monto } = validacion.data; // Data is now guaranteed to be clean and typed
    await GastoBLL.crearGasto(descripcion, monto);
});
```