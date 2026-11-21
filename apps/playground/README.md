# Playground

Local test environment for the Colabonate Design System and protocol simulations.

## Getting Started

```bash
# From the monorepo root:
npx pnpm playground

# Or directly:
cd apps/playground
npx pnpm dev
```

Open [http://localhost:5174](http://localhost:5174)

## Sections

| Section            | Purpose                                              |
|--------------------|------------------------------------------------------|
| Design System      | Tokens: colors, spacing, typography, radius, shadow  |
| Components         | Gallery of project-specific @ds/ui components        |
| Protocol Simulator | Ticket, cooperation and DAO flow simulations         |
| Identity           | L0 → L2 identity and reputation simulation           |
| Demo Login         | Mint demo sessions and open the app as a seeded user |

## Workflow

1. Change tokens in Figma
2. MCP export → `packages/tokens/tokens.json` update
3. Run `npx pnpm tokens:build`
4. Playground auto-reload → changes visible
