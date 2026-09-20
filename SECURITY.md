# Security

## Local-first default

The server binds to `127.0.0.1` by default. Do not set `HOST=0.0.0.0` or expose the app through a tunnel, reverse proxy, or public host unless authentication, transport security, access control, and the sensitivity of local runtime data have been assessed.

## Secrets and private data

Use the ignored `job-sources.config.json` or environment variables for local credentials. Never commit filled configuration, databases, career state, mailbox evidence, application documents, or exports.

## Reporting

If you find a security problem, do not include private candidate data or credentials in a public issue. Use a minimal reproducible example with fictional data.
