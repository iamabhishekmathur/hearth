# How to Contribute

Welcome to Hearth! We are glad you are interested in contributing. Hearth is an open-source AI productivity platform for teams, released under the [AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html) license. Contributions of all sizes are valued -- from fixing a typo to implementing a major feature.

All contributions require a [Developer Certificate of Origin](https://developercertificate.org/) sign-off — see the [DCO section in CONTRIBUTING.md](https://github.com/iamabhishekmathur/hearth/blob/main/CONTRIBUTING.md#developer-certificate-of-origin-dco) for details. In short: append `-s` to every `git commit`.

## Ways to Contribute

There are many ways to help improve Hearth beyond writing code:

- **Bug reports** -- Found something broken? Open a GitHub issue with steps to reproduce.
- **Feature requests** -- Have an idea that would make Hearth better? File an issue describing the use case and proposed behavior.
- **Code** -- Fix bugs, implement features, or improve performance. See the PR process below.
- **Documentation** -- Improve guides, add examples, or fix inaccuracies in the docs.
- **Skills** -- Build new Hearth skills that extend what the agent can do. See the [SKILL.md Format](/developers/skill-format) for the skill interface.

## Pull Request Process

1. **Fork** the repository and clone your fork locally.
2. **Create a branch** from `main` with a descriptive name (e.g., `fix/chat-scroll-bug` or `feat/calendar-skill`).
3. **Implement** your change. Follow the project conventions described in the [Development Setup](./development.md) guide.
4. **Test** your change. Run `pnpm test` to execute the unit test suite. Add or update tests for any new or changed behavior.
5. **Lint** your code. Run `pnpm lint` and fix any issues. You can auto-fix most formatting problems with `pnpm lint:fix`.
6. **Open a pull request** against `main`. Fill in the PR template with a clear description of what changed and why.
7. **Review** -- a maintainer will review your PR. Address any feedback and push updates to the same branch.

PRs should be focused and self-contained. If your change touches multiple concerns, consider splitting it into separate PRs.

## Issue Guidelines

When opening an issue, please include:

- **For bug reports:** a clear description of the problem, steps to reproduce, expected vs. actual behavior, and your environment (OS, Node.js version, browser).
- **For feature requests:** the use case or problem you are trying to solve, your proposed solution, and any alternatives you considered.

Check existing issues before opening a new one to avoid duplicates.

## Code of Conduct

We are committed to providing a welcoming and respectful environment for everyone. All participants in the Hearth community are expected to treat others with respect, act professionally, and engage constructively. Harassment, discrimination, and abusive behavior are not tolerated.

## Questions?

If you have questions about contributing, the codebase, or how a feature works, open a GitHub issue with the **question** label. We are happy to help.

## Getting Started

Ready to dive in? Head to the [Development Setup](./development) guide to get your local environment running.
