# Database Migrations

This project uses Drizzle ORM for database migrations with automatic migration support.

## Automatic Migrations

Migrations run automatically when you:

- Start the development server: `npm run dev`
- Start the production server: `npm start`

This ensures your database schema is always up to date.

## Manual Migration Commands

```bash
# Generate a new migration from schema changes
npm run db:generate

# Run pending migrations manually
npm run db:migrate

# Push schema changes directly (development only)
npm run db:push

# Open Drizzle Studio to view/edit data
npm run db:studio
```

## Configuration

### Environment Variables

- `DATABASE_URL`: PostgreSQL connection string (required)
- `AUTO_MIGRATE`: Set to `true` to enable auto-migration in production (optional)
- `NODE_ENV`: When set to `development`, auto-migration is enabled by default

### Migration Behavior

- **Development**: Migrations run automatically on startup
- **Production**: Migrations only run if `AUTO_MIGRATE=true` is set
- **Migration Errors**: In production, the app will fail to start if migrations fail

## Creating Custom Migrations

For complex schema changes (like enum modifications):

```bash
npx drizzle-kit generate --custom
```

Then edit the generated SQL file in the `drizzle/` directory.

## Troubleshooting

If migrations fail:

1. Check your DATABASE_URL is correct
2. Ensure the database user has schema modification permissions
3. Review migration files in `drizzle/` directory
4. Check logs for specific error messages

For manual migration without the app:

```bash
npx tsx app/lib/db/migrate.ts
```
