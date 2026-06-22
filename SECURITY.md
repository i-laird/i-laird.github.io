# Security Policy

## Reporting a vulnerability

If you find a security issue — in the site, in the experimental LLM-HAL backend,
or anywhere else — please report it privately rather than opening a public
issue.

Email **secure@ilaird.com** with:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if you have one), and
- any affected URL or component.

You can expect an acknowledgement within a few days. Please give a reasonable
window to address the issue before any public disclosure.

## Scope

The site is static and ships no runtime dependencies, so its attack surface is
small. The notable exception is the **opt-in** experimental LLM-HAL mode, which
talks to a separate backend service (Cloudflare Turnstile bot-gate + an API
Gateway endpoint). Reports touching that flow are especially welcome.

Out of scope: findings that require a compromised client/browser, social
engineering, or denial-of-service via traffic volume.
