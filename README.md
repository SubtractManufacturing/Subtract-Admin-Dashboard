# Subtract Manufacturing Admin Dashboard

A Remix-based admin dashboard for Subtract Manufacturing, enabling administration teams to manage customers, vendors, and orders. Built with React, TypeScript, Vite, and Drizzle ORM with PostgreSQL.

## Development Setup

### Prerequisites

- Node.js >= 20.0.0
- Supabase Instance
- npm or yarn package manager

### Environment Variables

Rename the `example.env` to `.env` and input your variables.

### Getting Started

1. Clone the repository:

```bash
git clone https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard
cd Subtract-Cloud-Frontend
```

2. Install dependencies:

```bash
npm ci
```

3. Set up the database:

```bash
npm run db:push  # Push schema to database (development)
npm run db:migrate  # Apply migrations (production)
```

Note: The Database will also be force applied any time you run the dev server `npm run dev`

4. Start the development server:

```bash
npm run dev  # Runs on http://localhost:5173
```

### Development Commands

- `npm run dev` - Start development server with hot reloading
- `npm run build` - Build for production
- `npm start` - Run production build
- `npm run lint` - Run ESLint
- `npm run typecheck` - Check TypeScript types
- `npm run db:studio` - Open Drizzle Studio database GUI

## Git Workflow

### Branch Naming Convention

All branches should follow this structure: `[prefix]/[issue-id]-[brief-description]`

#### Prefixes

| Prefix        | Purpose                                          |
| ------------- | ------------------------------------------------ |
| `feature/`    | New features or enhancements                     |
| `bugfix/`     | Fixing a bug in production or staging            |
| `hotfix/`     | Urgent fixes that must go directly to production |
| `release/`    | Preparing a release branch                       |
| `chore/`      | Maintenance, tooling, config changes             |
| `experiment/` | Prototypes or spikes                             |

#### Branch Naming Rules

1. **Include GitHub issue ID** for traceability
2. **Use kebab-case** for readability
3. **Keep it short but descriptive**
   Example: "#85-hotfix-thisbug"

#### Examples

- `feature/23-add-user-authentication`
- `bugfix/36-fix-null-pointer`
- `hotfix/89-critical-payment-bug`
- `chore/45-update-dependencies`
- `feature/api-102-add-search-endpoint`
- `bugfix/ui-207-header-overlap`

### Commit Message Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/) specification.

#### Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

#### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, semicolons, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `build`: Build system or dependency changes
- `ci`: CI/CD configuration changes
- `chore`: Maintenance tasks
- `revert`: Reverting a previous commit

#### Examples

```bash
feat(orders): add bulk order export functionality

fix(auth): resolve login timeout issue

docs: update API documentation

refactor(customers): simplify customer validation logic

chore: update dependencies to latest versions
```

#### Commit Guidelines

- Use present tense ("add feature" not "added feature")
- Keep subject line under 50 characters
- Capitalize the subject line
- Don't end subject with a period
- Reference issues in footer: `Closes #123`

## Architecture

Steering docs for navigating the codebase:

| Doc | Purpose |
|-----|---------|
| [CONTEXT.md](CONTEXT.md) | Domain vocabulary, entity lifecycles, naming conventions |
| [docs/architecture-map.md](docs/architecture-map.md) | Where routes, lib modules, queues, and downloads live |
| [docs/adr/README.md](docs/adr/README.md) | Architecture decision backlog and accepted conventions |
| [CLAUDE.md](CLAUDE.md) | Dev commands, DB rules, download patterns |

The app covers CRM (customers, vendors), quoting, orders, parts/CAD, outbound email, Toolpath integration, and platform admin. `npm run dev` starts Remix and the pg-boss worker (`scripts/worker.ts`) for async email, CAD conversion, and Toolpath jobs.

## Project Structure

```
Subtract-Cloud-Frontend/
├── app/
│   ├── components/     # React UI (orders, quotes, email, admin, shared)
│   ├── lib/            # Server logic and data access
│   │   ├── db/         # Drizzle schema and client
│   │   ├── email/      # Outbound email subsystem
│   │   └── queue/      # pg-boss producers and handlers
│   ├── routes/         # Remix routes (~41 files)
│   ├── emails/         # React Email layouts
│   └── hooks/          # useDownload, useMeshConversion
├── docs/               # Architecture map, ADRs, email/PDF guides
├── scripts/            # worker.ts (pg-boss consumer)
├── public/             # Static assets
└── package.json
```

## Contributing

1. Create a new branch following the naming convention
2. Make your changes
3. Run quality checks:
   ```bash
   npm run lint
   npm run typecheck
   ```
4. Commit using conventional commits
5. Push your branch and create a pull request
6. Reference the related issue in your PR description
