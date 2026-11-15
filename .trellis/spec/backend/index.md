# Backend Development Guidelines Index

> **Actual stack**: The existing desktop uses Electron, host-kernel, FileConfigStore and encrypted credentials. The additive [companion service](companion-service.md) uses the same kernel/SDK plus a `node:sqlite` state plugin, Docker execution and HTTP/SSE. Read [Project baseline](../shared/project-baseline.md) first. Generic Drizzle/Zod templates are not the implemented stack.

## Related Guidelines

| Guideline                 | Location     | When to Read                 |
| ------------------------- | ------------ | ---------------------------- |
| **Shared Code Standards** | `../shared/` | Always - applies to all code |

---

## Documentation Files

| File                                               | Description                                       | When to Read                       |
| -------------------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| [companion-service.md](./companion-service.md) | Executable service/State4/worker/Harness contracts | Headless service and feature plugins |
| [qq-platform-entry.md](./qq-platform-entry.md) | Scoped QQ admission, shared native sources, materials and State4 delivery facts | QQ entry and cross-layer scope/authority changes |
| [local-plugin-host.md](./local-plugin-host.md) | Independent daemon, native console, remote task authority and portable runtime contracts | Local-host bridge, desktop handoff and package lifecycle changes |
| [model-connections.md](./model-connections.md) | Native connector authority, model configuration/checks and snapshot budget | Model-connection plugins and owner APIs |
| [desktop-companion.md](./desktop-companion.md) | Shared Main/preload client, source lifetime, saved facts and native publication | Desktop service entry and connection/lifecycle changes |
| [persona-memory.md](./persona-memory.md) | Canonical persona application, scoped fact authority, CAS/replay and cold migration | Persona/memory APIs, Harness context and format upgrades |
| [shared-voice-input.md](./shared-voice-input.md) | Shared ASR/capture authority, fixed bridge, bounded media, lifetime and UI state contracts | Service voice sources and web/desktop voice consumers |
| [shared-speech-output.md](./shared-speech-output.md) | Canonical TTS admission, Magpie streaming, bounded playback, real cleanup and settings ownership | Speech sources, Main/Pet audio and speech configuration |
| [directory-structure.md](./directory-structure.md) | Project structure and domain organization         | Starting a new feature             |
| [api-module.md](./api-module.md)                   | API module pattern (types, procedures, lib)       | Creating/modifying service modules |
| [api-patterns.md](./api-patterns.md)               | Common patterns for API calls and data operations | Implementing CRUD, pagination      |
| [error-handling.md](./error-handling.md)           | Error handling strategies in procedures           | Handling errors in transactions    |
| [database.md](./database.md)                       | Drizzle ORM, schema, migrations                   | Database operations                |
| [environment.md](./environment.md)                 | Dev/prod isolation, userData separation           | Setting up environment, debugging  |
| [type-safety.md](./type-safety.md)                 | Zod schemas, discriminated unions, type patterns  | Type-related decisions             |
| [logging.md](./logging.md)                         | Logging and native module packaging               | Debugging, packaging               |
| [pagination.md](./pagination.md)                   | Cursor vs offset pagination guidelines            | Implementing list APIs             |
| [quality.md](./quality.md)                         | Import paths, Vite config, code quality           | Before committing                  |
| [macos-permissions.md](./macos-permissions.md)     | macOS system permissions (mic, accessibility)     | Features requiring permissions     |
| [text-input.md](./text-input.md)                   | Text insertion without clipboard pollution        | Voice-to-text, paste features      |

---

## Quick Navigation

### Service Module Structure

| Task                          | File                                               |
| ----------------------------- | -------------------------------------------------- |
| Project structure             | [directory-structure.md](./directory-structure.md) |
| Domain module pattern         | [api-module.md](./api-module.md)                   |
| Write types.ts                | [api-module.md](./api-module.md)                   |
| Write procedure               | [api-module.md](./api-module.md)                   |
| Write lib/ helpers            | [api-module.md](./api-module.md)                   |
| Common patterns               | [api-patterns.md](./api-patterns.md)               |
| Anti-patterns                 | [api-patterns.md](./api-patterns.md)               |
| Pagination (cursor vs offset) | [pagination.md](./pagination.md)                   |

### Type Safety

| Task                 | File                               |
| -------------------- | ---------------------------------- |
| Type safety patterns | [type-safety.md](./type-safety.md) |
| Discriminated unions | [type-safety.md](./type-safety.md) |
| Zod-first types      | [type-safety.md](./type-safety.md) |
| Zod error handling   | [type-safety.md](./type-safety.md) |

### Database (Drizzle + SQLite)

| Task                 | File                         |
| -------------------- | ---------------------------- |
| Setup Drizzle client | [database.md](./database.md) |
| Define schema        | [database.md](./database.md) |
| Timestamp precision  | [database.md](./database.md) |
| Batch queries        | [database.md](./database.md) |
| Database migrations  | [database.md](./database.md) |

### Error Handling

| Task                    | File                                     |
| ----------------------- | ---------------------------------------- |
| Error categories        | [error-handling.md](./error-handling.md) |
| Transaction errors      | [error-handling.md](./error-handling.md) |
| Input validation errors | [error-handling.md](./error-handling.md) |

### Configuration & Logging

| Task                     | File                               |
| ------------------------ | ---------------------------------- |
| Environment isolation    | [environment.md](./environment.md) |
| Logging                  | [logging.md](./logging.md)         |
| Scoped logger            | [logging.md](./logging.md)         |
| Packaging native modules | [logging.md](./logging.md)         |

### Import Paths & Quality

| Task                       | File                       |
| -------------------------- | -------------------------- |
| Main process imports       | [quality.md](./quality.md) |
| Renderer imports (@shared) | [quality.md](./quality.md) |
| Code quality               | [quality.md](./quality.md) |

---

## Core Rules Summary

| Rule                                                           | Reference                                      |
| -------------------------------------------------------------- | ---------------------------------------------- |
| **Isolate dev/prod userData directories**                      | [environment.md](./environment.md)             |
| **Import env-setup first** (before electron-store)             | [environment.md](./environment.md)             |
| **Main process: use relative paths** for `src/shared/` imports | [quality.md](./quality.md)                     |
| **Renderer: use `@shared` alias** for shared types             | [quality.md](./quality.md)                     |
| **Service modules follow domain layout**                       | [api-module.md](./api-module.md)               |
| **IPC handlers are thin wrappers** calling procedures          | [api-module.md](./api-module.md)               |
| **Transaction helpers must throw**, not silent return          | [error-handling.md](./error-handling.md)       |
| **Data integrity errors must throw** in transactions           | [error-handling.md](./error-handling.md)       |
| **All types from Zod schemas**                                 | [type-safety.md](./type-safety.md)             |
| **No non-null assertions `!`**                                 | [type-safety.md](./type-safety.md)             |
| **Use cursor pagination** for user-facing lists                | [pagination.md](./pagination.md)               |
| **Use `timestamp_ms` mode** for millisecond precision          | [database.md](./database.md)                   |
| **Use `logger.scope()`** for module loggers                    | [logging.md](./logging.md)                     |
| **Check permissions before use** on macOS                      | [macos-permissions.md](./macos-permissions.md) |
| **Use direct text insertion** instead of clipboard             | [text-input.md](./text-input.md)               |

---

## Reference Files

| Feature            | Typical Location                   |
| ------------------ | ---------------------------------- |
| Drizzle Client     | `src/main/db/client.ts`            |
| Schema Definition  | `src/main/db/schema.ts`            |
| IPC Channels       | `src/shared/constants/channels.ts` |
| Shared Types (Zod) | `src/shared/types/`                |
| Service Module     | `src/main/services/{domain}/`      |

---

**Language**: All documentation must be written in **English**.
