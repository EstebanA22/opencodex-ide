# Compatibilidad con otros IDEs

OpenCodex IDE es una extensión **VS Code compatible** (`engines.vscode`). El mismo `.vsix` funciona en:

| IDE | Instalación |
|-----|-------------|
| **Cursor** | `cursor --install-extension opencodex-ide-0.4.0.vsix` |
| **VS Code** | `code --install-extension opencodex-ide-0.4.0.vsix` |
| **VSCodium** | `codium --install-extension opencodex-ide-0.4.0.vsix` |
| **Windsurf** | `windsurf --install-extension opencodex-ide-0.4.0.vsix` (si el CLI está en PATH) |
| **code-server / GitHub Codespaces** | Instalar el VSIX desde la UI de Extensions |

Script helper:

```bash
npm run package
npm run install:ides
```

## Requisito común

El proxy local debe estar corriendo:

```bash
ocx service start
ocx health
```

Base URL: `http://127.0.0.1:10100/v1`

## Otros editores (JetBrains, Neovim, Zed)

No hay plugin nativo todavía. Puedes apuntar cualquier cliente OpenAI-compatible al mismo proxy:

- Base URL: `http://127.0.0.1:10100/v1`
- API Key: `dummy` (loopback) o la de tu provider
- Modelos: los que liste `GET /v1/models` + ids `provider/model` del catálogo

## Marketplace

Publisher: `novexus` (Visual Studio Marketplace).  
Distribución actual: [GitHub Releases](https://github.com/EstebanA22/opencodex-ide/releases) + VSIX (CI).  
Publicación al Marketplace: `npx vsce publish` con PAT de Azure DevOps.
