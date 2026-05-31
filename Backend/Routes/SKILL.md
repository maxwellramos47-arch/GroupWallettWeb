---
name: groupwallet-backend-standards
description: GroupWallet standard practices for Node.js API security, input validation with Zod, and safe Prisma ORM usage. Use this skill when creating new routes, BLLs, DALs, or modifying database queries.
license: MIT
author: GroupWalletWeb Team
version: "1.0.0"
---

# GroupWallet Backend Standards

Comprehensive security and structure guide for the Node.js/Express backend. Follow these rules to prevent SQL Injection, Denial of Service (DoS), and maintain strict type safety.

## When to Apply

- Creating new API endpoints in the `Routes/` folder.
- Writing database queries in the `DAL/` (Data Access Layer) folder.
- Reviewing Pull Requests or implementing new features.

## Core Verifications & Streamline

1. **Input Validation**: Never trust `req.body` or `req.query`. Always define a `zod` schema and validate inputs before passing data to the BLL.
2. **SQL Injection Prevention**: Never use `prisma.$queryRawUnsafe`. Always use `prisma.$queryRaw` with tagged template literals to ensure parameters are sent as Prepared Statements.
3. **Authentication**: All private routes must use the `verificarToken` middleware.

## References

- `references/input-validation.md` (How to use Zod)
- `references/sql-injection-prevention.md` (How to use Prisma safely)