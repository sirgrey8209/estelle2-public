# Estelle

> Control Claude Code remotely from any device - phone, tablet, or another PC.

Estelle syncs Claude Code sessions across all your devices in real-time. Run Claude Code on your server, and interact with it from anywhere through a web interface.

## Architecture

```
                    Server (Linux)
  ┌──────────────────────────────────────────────┐
  │                                              │
  │  ┌──────────┐    ┌──────────┐               │
  │  │  Pylon   │◄──►│  Relay   │◄────────┐     │
  │  │ (PM2)    │    │ (PM2)    │         │     │
  │  └──────────┘    └──────────┘         │     │
  │       │                          WebSocket   │
  │  Claude Code                          │     │
  └───────────────────────────────────────┼─────┘
                                          │
            ┌─────────────────────────────┼──────────┐
            │                             │          │
      ┌─────┴─────┐               ┌──────┴────┐ ┌───┴─────┐
      │  Browser  │               │  Mobile   │ │ Other   │
      │  Client   │               │  Client   │ │ PC      │
      └───────────┘               └───────────┘ └─────────┘
```

| Component | Role |
|-----------|------|
| **Relay** | Stateless message router - authentication and WebSocket routing |
| **Pylon** | State manager - Claude Agent SDK integration, single source of truth |
| **Client** | React PWA - works on any device with a browser |
| **Archive** | Document sharing - HTTP API + MCP tools for file storage |

## Features

- **Multi-device sync** - Continue conversations from any device
- **Real-time streaming** - See Claude's responses as they generate
- **File transfer** - Send files to Claude, receive generated files
- **Workspace management** - Organize conversations into workspaces
- **Account switching** - Switch between work/personal Claude accounts
- **Archive system** - Shared document storage accessible via MCP tools
- **PWA support** - Install as an app on mobile
- **Macro system** - Custom slash commands for repetitive tasks

## Quick Start

> This project is designed to be set up by Claude Code itself.

### Local (same PC only)

Ask Claude Code:
```
Install Estelle in local mode
```

Details: [Local deployment guide](doc/deploy-local.md)

### Remote (server deployment)

Ask Claude Code:
```
Install Estelle in remote mode
```

**You need:**
- Linux server (Ubuntu 20.04+)
- Node.js 20+, pnpm, PM2

Details: [Remote deployment guide](doc/deploy-remote.md)

## Project Structure

```
estelle2/
├── packages/
│   ├── core/       # Shared types and message schemas
│   ├── relay/      # Relay server (stateless WebSocket router)
│   ├── pylon/      # Pylon service (Claude SDK integration, MCP server)
│   ├── client/     # React web client (Vite + shadcn/ui)
│   ├── archive/    # Archive server (document sharing HTTP API)
│   ├── updater/    # Deployment automation (Git-based hot reload)
│   └── tunnel/     # WebSocket tunneling (experimental)
├── config/         # Environment configurations
├── scripts/        # Build and deploy scripts (cross-platform)
├── widget/         # Interactive widget examples (MCP run_widget)
├── doc/            # Architecture and deployment docs
├── docs/plans/     # Design documents and implementation plans
└── .claude/skills/ # Claude Code skills for development
```

## Claude Code Skills

Estelle includes custom skills that help Claude Code understand and develop the system:

| Skill | Purpose |
|-------|---------|
| `estelle-info` | System overview - architecture, components, how things connect |
| `estelle-master` | Code-level reference - message types, data flow, MCP tools, test patterns |
| `estelle-hub` | Hub dashboard - project registration and management |
| `estelle-patch` | Deployment - version bumping, git pull, PM2 orchestration |
| `estelle-widget` | Interactive widgets - CLI protocol, inline HTML rendering |
| `code-review-haniel` | Code review with persona - sharp, evidence-based reviewer subagent |

## Tech Stack

- **TypeScript** - Full type safety across all packages
- **pnpm workspaces** - Monorepo management
- **Vitest** - Fast unit testing with TDD
- **React + Vite** - Modern web client with shadcn/ui
- **Claude Agent SDK** - Direct Claude Code integration
- **Zustand** - Client state management
- **PM2** - Process management for production

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Build all packages
pnpm test           # Run tests
pnpm dev            # Start dev server
pnpm dev:stop       # Stop dev server
```

### MCP Ports

| Environment | Port |
|-------------|------|
| dev | 9878 |
| stage | 9877 |
| release | 9876 |

## Design Principles

### Pylon = Single Source of Truth

All state lives in Pylon. Clients only display data, never modify it directly.

```
Client → Request → Pylon → Process → Broadcast to all clients
```

### Pure Functions and Testability

- **Relay**: Stateless, pure routing functions
- **Pylon**: Pure data classes, testable without mocking

## Environment Variables

```bash
# Required for Google OAuth (archive auth)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
ALLOWED_EMAILS=your-email@gmail.com

# Optional
ARCHIVE_ROOT=/path/to/archive    # Default: /home/estelle/archive
ARCHIVE_PORT=3009                 # Default: 3009
ARCHIVE_API_KEY=your-api-key     # For server-to-server auth
```

## Status

> **Note**: Currently tested with a single Pylon setup. Multi-Pylon (multiple PCs running Pylon simultaneously) is not yet tested.

## License

MIT

---

*Built with Claude Code*
