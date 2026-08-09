# OpenCodex IDE

Extensión multi-agente para **VS Code / Cursor / VSCodium / Windsurf** contra un proxy local [`opencodex`](https://opencodex.me).

- UI en **español** (también inglés)
- Catálogo completo de **providers/modelos** OpenCodex
- No modifica Continue

## Instalar

```bash
npm ci && npm run compile && npm run test:security
npx vsce package --no-dependencies
npm run install:ides   # Cursor + VS Code + VSCodium + Windsurf si existen
```

O descarga el VSIX desde [Releases](https://github.com/EstebanA22/opencodex-ide/releases).

## Idioma

Setting `opencodex.locale`: `es` (default) | `en` | `auto`  
También hay selector Idioma/Language en el panel.

## Catálogo de modelos

- **Live**: lo que responde tu proxy (`/v1/models`)
- **Catálogo**: seeds de todos los providers del registry OpenCodex
- Pestaña **Proveedores**: activar/login con `ocx` (keys nunca al git)
- Checkbox **Mostrar catálogo completo**

Para que un modelo de catálogo funcione de verdad, activa su provider (`ocx login` / API key).

## Compatibilidad IDE

Ver [docs/IDE_COMPAT.md](./docs/IDE_COMPAT.md).

## Seguridad

Ver [SECURITY.md](./SECURITY.md).

## License

MIT
