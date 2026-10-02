# Contributing

Thanks for your interest in Protrion Timeline Skills. Bug reports, fixes, and improvements are
welcome.

Security vulnerabilities must not be reported as public issues - see [SECURITY.md](SECURITY.md).

## Issues and pull requests

- Open an issue on GitHub for a bug or a feature idea. For larger changes, open an issue first so the
  approach can be agreed before you write the code.
- Send changes as a pull request against the default branch. Keep each pull request focused on one
  change.

## Before you open a pull request

```
npm ci
npm run typecheck
npm test
```

Both checks run offline - no backend, browser, or credentials needed - and must pass.

New source files carry the SPDX header used throughout the repository:

```
// SPDX-FileCopyrightText: 2026 CITADELO s.r.o.
// SPDX-License-Identifier: Apache-2.0
```

## Licensing of contributions

This project is licensed under the [Apache License 2.0](LICENSE). By contributing, you agree that
your contribution is licensed under the same license (inbound = outbound). There is no Contributor
License Agreement (CLA) to sign.

## Developer Certificate of Origin (DCO)

Every commit must be signed off to certify that you have the right to submit it under the project's
license. Add the sign-off with `git commit -s`, which appends a line like:

```
Signed-off-by: Jane Doe <jane.doe@example.com>
```

The name and email must be your real ones and must match the commit author. To sign off commits you
already made on a branch, run `git rebase --signoff <base>` and force-push the branch.

By signing off, you certify the following
([developercertificate.org](https://developercertificate.org/)):

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```
