---
title: Prevent SQL Injection using Prisma Tagged Templates
impact: CRITICAL
impactDescription: Prevents attackers from executing arbitrary SQL commands
tags: sql-injection, prisma, security, dal
---

## Prevent SQL Injection using Prisma Tagged Templates

When writing raw SQL queries in the Data Access Layer (DAL), using `$queryRawUnsafe` makes the application vulnerable to SQL Injection if user input is mishandled.

**Incorrect (Vulnerable to SQL Injection):**

```javascript
// VULNERABLE: Never use $queryRawUnsafe
const result = await prisma.$queryRawUnsafe(
    `SELECT * FROM Usuarios WHERE correo = '${correo}'`
);
```

**Correct (Using Tagged Template Literals):**

```javascript
// SAFE: Prisma intercepts the template literal and converts variables into Prepared Statements ($1, $2)
const result = await prisma.$queryRaw`
    SELECT * FROM Usuarios WHERE correo = ${correo}
`;
```

### Guidelines
- For standard CRUD operations, always prefer Prisma's generated methods (e.g., `prisma.usuarios.findUnique`).
- If raw SQL is absolutely necessary for complex queries or updates, **only** use `prisma.$queryRaw` or `prisma.$executeRaw` with template literals.
- Ensure types are explicitly cast if needed inside the template (e.g., `${parseInt(id)}`).