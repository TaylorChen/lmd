# Security Policy

## Supported Versions

LMD is still in an early stage. Security fixes are currently targeted at the latest commit on `master` and the latest tagged release, if one exists.

Older snapshots may not receive fixes.

## Reporting a Vulnerability

Please do not open a public issue for a suspected security problem.

Report it privately with:

- a clear description of the issue
- impact and affected area
- reproduction steps or a proof of concept
- platform details
- any suggested remediation if you already have one

If private reporting contact details are added later, this file should be updated to point to them directly. Until then, maintainers should treat security reports as priority work and move them out of public discussion as early as possible.

## Response Expectations

Current target process:

- acknowledge receipt within 7 days
- reproduce and assess severity
- prepare a fix and regression coverage where practical
- publish the fix with release notes once the issue is resolved

## Scope Notes

Areas that deserve extra care in this project:

- local file read and write behavior
- export pipelines for HTML and PDF
- path handling across workspace search and file open flows
- any future shell integration, plugin, or network feature
