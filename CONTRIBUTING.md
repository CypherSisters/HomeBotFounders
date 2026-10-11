# Contributing to PuffPAI

Thank you for your interest in contributing to PuffPAI! This document provides guidelines for contributing.

## Start here

You are welcome here, whether you have one sentence to say or a whole
refactor. We built HomeBot with AI coding tools, and we would love people who
write code for a living to read it and tell us what they'd change
([README, "How this was built"](README.md#how-this-was-built)).

**File an issue.** [Open a new issue](https://github.com/CypherSisters/HomeBotFounders/issues/new/choose)
and pick a form: **Bug report** (something broke), **Capability gap** (it
didn't do or understand what you asked), **Idea** (a use case or feature,
emergency preparedness or anything else), or **Code feedback** (you read the
code and have refactors, architecture or test changes in mind). Or open a
blank issue and just write. Security problems go to private vulnerability
reporting instead ([SECURITY.md](SECURITY.md)).

**Send a pull request.** Fork, branch from `main`, keep the change focused,
and add the test that would have caught the bug. Fill in the short pull
request form: what changed, and the test commands you ran with their results
before and after. Read [AGENTS.md](AGENTS.md) first: section 5 lists the
contracts a change must keep and the tests that pin them, section 8 what
never to do.

**Run the tests.** Use the isolated command in
[AGENTS.md section 4](AGENTS.md#4-running-the-tests), so nothing reads your OS
keyring, a real API key or real state. The suite has known failures (the
README's Test status paragraph says where they cluster); compare the failure
list before and after your change. A failure that was already there is not
yours. No CI runs on this repository, so your test output in the pull request
is the record.

The rest of this document is the detail.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Coding Standards](#coding-standards)
- [Pull Request Process](#pull-request-process)
- [Community](#community)

---

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inspiring community for all. Please be respectful and constructive.

### Our Standards

**Positive behavior:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Gracefully accepting constructive criticism
- Focusing on what is best for the community

**Unacceptable behavior:**
- Harassment of any kind
- Trolling or insulting comments
- Publishing others' private information
- Other conduct which could reasonably be considered inappropriate

---

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues. When creating a bug report, include:

- **Clear title** describing the issue
- **Detailed steps** to reproduce
- **Expected behavior** vs actual behavior
- **System information** (OS, Python version, hardware)
- **Screenshots** if applicable
- **Logs** from the installer's output or `journalctl -u puffpai-api`

The Bug report form asks for all of this. As a guide:
```markdown
**Environment:**
- OS: Ubuntu 22.04, JetPack 6.2.2
- Python: 3.10.12
- Commit: <git rev-parse --short HEAD>
- Hardware: Jetson AGX Orin 64GB

**Steps to Reproduce:**
1. Start PuffPAI
2. Click "New Chat"
3. Send message "test"

**Expected Behavior:**
Response appears in chat

**Actual Behavior:**
Application crashes with error

**Error Message:**
[Paste error here]
```

### Suggesting Features

Feature requests are welcome! Please:

- **Check existing requests** first
- **Explain the use case** clearly
- **Describe the expected behavior**
- **Consider alternatives** you've thought about

### Contributing Code

We welcome pull requests for:

- Bug fixes
- Fixes for the known failing tests
- Refactors and architecture changes, with the tests that prove nothing broke
- New agent tools
- Documentation improvements
- Translations
- Accessibility improvements
- Performance optimizations

---

## Development Setup

### Prerequisites

- Python 3.10+
- Git
- Ollama with `gpt-oss:20b` and `nomic-embed-text` (the appliance also runs `qwen3:30b-a3b` and `qwen2.5vl:7b`)
- 32GB RAM (16GB is the floor; the two large models will not co-reside below 32GB)

### Setup Steps

1. **Fork the repository**
   ```bash
   # Click "Fork" on GitHub
   ```

2. **Clone your fork**
   ```bash
   git clone https://github.com/<you>/HomeBotFounders.git
   cd HomeBotFounders
   ```

3. **Add upstream remote**
   ```bash
   git remote add upstream https://github.com/CypherSisters/HomeBotFounders.git
   ```

4. **Create virtual environment**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   pip install -e ".[dev]"  # Install with dev dependencies
   ```

5. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

### Running Tests

Always run pytest isolated, with the environment from
[AGENTS.md section 4](AGENTS.md#4-running-the-tests) (`PYTHONPATH=src`, the
null keyring, a throwaway `PUFFPAI_API_KEY`, temporary `PUFFPAI_DATA_DIR` and
`PUFFPAI_STATE_DIR`). With that set:

```bash
# Run specific test
python -m pytest -q -p no:cacheprovider tests/test_release_doors_shut.py

# Run with coverage
python -m pytest -q -p no:cacheprovider --cov=src/puffpai tests/test_release_doors_shut.py

# Run all tests (large, with known failures: compare before and after)
python -m pytest -q -p no:cacheprovider
```

### Code Quality

```bash
# Format code
black src/puffpai

# Lint code
flake8 src/puffpai

# Type checking
mypy src/puffpai
```

---

## Coding Standards

### Python Style

- Follow **PEP 8** style guide
- Use **Black** for formatting (line length: 100)
- Use **type hints** for function signatures
- Write **docstrings** for all public functions

**Example:**
```python
def calculate_water_needs(
    people: int,
    days: int,
    gallons_per_person_per_day: float = 1.0
) -> float:
    """
    Calculate total water needs for emergency preparedness.
    
    Args:
        people: Number of people
        days: Number of days
        gallons_per_person_per_day: Water consumption rate
        
    Returns:
        Total gallons needed
        
    Example:
        >>> calculate_water_needs(4, 14)
        56.0
    """
    return people * days * gallons_per_person_per_day
```

### Git Commit Messages

Follow conventional commits format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, no logic change)
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(tools): add firewall integration for device blocking

Implements network firewall rules to block specific devices
from internet access while maintaining local network connectivity.

Closes #123
```

```
fix(rag): handle empty search results gracefully

Previously crashed when no results found. Now returns helpful
message suggesting alternative search terms.

Fixes #456
```

### Documentation

- Update README.md for major features
- Add docstrings to all functions
- Include examples in docstrings
- Update relevant docs/ files
- Add comments for complex logic

---

## Pull Request Process

### Before Submitting

- [ ] Code follows style guidelines
- [ ] The tests covering what you changed pass locally, and the full-suite failure list has no new names
- [ ] Code is formatted (`black`, `flake8`)
- [ ] Documentation is updated
- [ ] Commit messages are clear
- [ ] Branch is up to date with `main`

### PR Description Template

```markdown
## Description
[Clear description of what this PR does]

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement

## Testing
[How was this tested?]

## Screenshots (if applicable)
[Add screenshots]

## Checklist
- [ ] Code follows style guidelines
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No breaking changes
- [ ] Tested on Linux/Jetson

## Related Issues
Closes #[issue number]
```

### Review Process

1. **Test evidence** in the pull request (no CI runs on this repository yet)
2. **Code review** by maintainers
3. **Testing** on multiple platforms if needed
4. **Approval** from at least one maintainer
5. **Merge** by maintainers

### After PR is Merged

```bash
# Sync your fork
git checkout main
git pull upstream main
git push origin main

# Delete your feature branch
git branch -d feature/your-feature-name
git push origin --delete feature/your-feature-name
```

---

## Community

### Communication Channels

- **GitHub Issues**: Bug reports, capability gaps, ideas, code feedback, questions
- **Pull Requests**: Code contributions

### Recognition

Contributors will be:
- Mentioned in release notes
- Credited in project documentation

### Priority Areas

We especially need help with:

1. **Testing** on different hardware (Jetson models, various GPUs), and a first install on a fresh Orin
2. **The known failing tests** and the **known gaps** in [AGENTS.md](AGENTS.md) section 1
3. **Documentation** improvements and tutorials
4. **Translations** for international users
5. **Accessibility** features
6. **New agent tools**

---

## Questions?

- **General questions**: [open a blank issue](https://github.com/CypherSisters/HomeBotFounders/issues/new) and just ask
- **Bug reports**: [GitHub Issues](https://github.com/CypherSisters/HomeBotFounders/issues)
- **Security issues**: See [SECURITY.md](SECURITY.md): use GitHub private vulnerability reporting, not a public issue or email

---

Thank you for contributing to PuffPAI.
