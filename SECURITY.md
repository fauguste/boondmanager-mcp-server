# Security Policy

## Reporting a Vulnerability

If you find a security issue in this MCP server — credential leakage,
authentication bypass, request smuggling, log poisoning, supply-chain risk,
anything that could expose BoondManager data — please report it privately
rather than opening a public issue.

**Preferred channel** — open a [private security advisory on GitHub](https://github.com/fauguste/boondmanager-mcp-server/security/advisories/new).
This keeps the discussion confidential until a fix ships.

**Alternative** — email `frederic.auguste@gmail.com` with subject prefix
`[boondmanager-mcp-server SECURITY]`. Include:

- A clear description of the issue and impact
- Reproduction steps (commands, request payloads, environment)
- The affected version (`boondmanager-mcp-server --version` or commit hash)
- Whether the issue is already public anywhere

We aim to acknowledge reports within **3 working days** and to ship a fix
or mitigation within **30 days** for confirmed high-severity issues. We
will credit you in the release notes unless you prefer to stay anonymous.

## Supported Versions

Only the latest minor version receives security fixes. Older minors are not
back-patched — please upgrade.

| Version  | Supported          |
| -------- | ------------------ |
| `1.5.x`  | :white_check_mark: |
| `< 1.5`  | :x:                |

## Scope

In scope:

- The MCP server source code in this repository (`src/`)
- The published npm package `boondmanager-mcp-server`
- The `.mcpb` bundle attached to GitHub Releases
- The Streamable HTTP transport (`src/transports/http.ts`)
- The release pipeline (`.github/workflows/release.yml`)

Out of scope:

- Vulnerabilities in the upstream BoondManager API itself — please report
  those directly to BoondManager support.
- Vulnerabilities in third-party MCP clients (Claude Desktop, Claude Code,
  LobeChat, Smithery, etc.) — please report to the respective vendor.
- Issues that require physical access to a user's machine, or that depend
  on the user willingly leaking their own credentials.

## Handling of Credentials

This server reads BoondManager credentials from environment variables only
— there is no on-disk persistence and nothing is logged. Credentials are
forwarded only to the configured `BOOND_BASE_URL` over HTTPS. The
recommended auth path is JWT generated locally from the three components
(`BOOND_USER_TOKEN` + `BOOND_CLIENT_TOKEN` + `BOOND_CLIENT_KEY`); no
credential round-trips through any third party. See `README.md` for the
full configuration reference.

If you find anywhere credentials are logged, persisted, or transmitted
outside the configured base URL, treat it as a high-severity bug and
report it via the channel above.
