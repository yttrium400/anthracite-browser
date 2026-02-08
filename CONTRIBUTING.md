# Contributing to Poseidon 🔱

First off, thanks for taking the time to contribute! 🎉

The following is a set of guidelines for contributing to Poseidon. These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

## Code of Conduct

This project and everyone participating in it is governed by the [Poseidon Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## How Can I Contribute?

### Reporting Bugs

This section guides you through submitting a bug report for Poseidon. Following these guidelines helps maintainers and the community understand your report, reproduce the behavior, and find related reports.

- **Use a clear and descriptive title** for the issue to identify the problem.
- **Describe the exact steps which reproduce the problem** in as many details as possible.
- **Provide specific examples to demonstrate the steps**. Include links to files or GitHub projects, or copy/pasteable snippets, which you use in those examples.
- **Describe the behavior you observed after following the steps** and point out what exactly is the problem with that behavior.
- **Explain which behavior you expected to see instead and why.**
- **Include screenshots and animated GIFs** which show you following the described steps and clearly demonstrate the problem.

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion for Poseidon, including completely new features and minor improvements to existing functionality.

- **Use a clear and descriptive title** for the issue to identify the suggestion.
- **Provide a step-by-step description of the suggested enhancement** in as many details as possible.
- **Provide specific examples to demonstrate the steps**.
- **Describe the current behavior** and **explain which behavior you expected to see instead** and why.

### Pull Requests

The process described here has several goals:

- Maintain Poseidon's quality
- Fix problems that are important to users
- Engage the community in working toward the best possible Poseidon
- Enable a sustainable system for Poseidon's maintainers to review contributions

Please follow these steps to have your contribution considered by the maintainers:

1.  Follow all instructions in [the template](.github/PULL_REQUEST_TEMPLATE.md)
2.  Follow the style guides
3.  After you submit your pull request, verify that all status checks are passing

## Styleguides

### Git Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line

### JavaScript / TypeScript Styleguide

- All JavaScript must adhere to [Prettier](https://prettier.io/) standards.
- Prefer `const` over `let`. Avoid `var`.
- Use TypeScript interfaces for props and state.

### Python Styleguide

- All Python code must adhere to [PEP 8](https://www.python.org/dev/peps/pep-0008/).
- Use type hints for function arguments and return values.

## Setting up the Development Environment

1.  **Install Node.js dependencies**:
    ```bash
    npm install
    ```

2.  **Setup Python environment**:
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    pip install -r backend/requirements.txt
    playwright install
    ```

3.  **Configure Environment Variables**:
    Create a `.env` file in the root directory and add your keys:
    ```
    OPENAI_API_KEY=your_key_here
    ```

4.  **Run the application**:
    ```bash
    npm run dev
    ```

Thank you for contributing!
