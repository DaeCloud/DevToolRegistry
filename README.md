# devtool-registry (template)

The list of tools DevToolLauncher shows. Copy this folder into its own repository, set `id`, `name`,
`homepage` and `publishUrl` in `registry.yaml`, and point the launcher at the published `index.json`.

## Add a tool

1. Copy `tools/_template/` to `tools/<tool-id>/` (lowercase, digits, dashes).
2. Fill in `tool.yaml`. Optional: drop an `icon.png` and/or `README.md` beside it.
3. `npm ci && npm run check` to validate.
4. Open a pull request. CODEOWNERS review is the trust gate before the tool reaches everyone's launcher.

## Manifest in one minute

| Block | Answers | Options |
| --- | --- | --- |
| `source` | Where do versions come from? | `github-release`, `gitlab-release`, `npm`, `docker`, `winget`, `url`, `none` |
| `install` | How is a version put on the machine? | `archive`, `msi`, `exe`, `npm-global`, `docker-pull`, `winget`, `browser-extension`, `none` |
| `run` | How is it launched? | `terminal`, `process`, `url`, `docker` profiles |
| `detect` | What version is installed outside the launcher? | a command + optional regex |

Private repos: set `auth: <profile>` on the source. Each developer creates that credential profile once in the
launcher's Settings; tokens are stored in Windows Credential Manager, never in this repo.

## Publishing

`.github/workflows/publish.yml` validates PRs and publishes `dist/` to GitHub Pages from `main`.
On GitLab, run `npm run build` in a `pages` job and publish `dist/` as `public/`.

`dist/index.json` is committed here only as sample data for launcher development; in a real registry
add `dist/` to `.gitignore` and let CI build it.
