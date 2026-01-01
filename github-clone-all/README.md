# GitHub Clone All

A tool to clone all repositories from a GitHub account (user or organization) into a local folder.

## Features

- Clone all repositories from a GitHub user or organization
- Update existing repositories (pull latest changes)
- Filter repositories by name
- Support for private repositories
- Use SSH or HTTPS URLs
- Interactive prompts for missing information

## Installation

```bash
cd github-clone-all
npm install
npm run build
```

## Web UI (Recommended)

The easiest way to use this tool is through the web interface:

```bash
npm run web
```

Then open your browser and navigate to `http://localhost:3000`

The web UI provides:
- Easy-to-use form interface
- Real-time progress updates
- Token validation
- Visual progress bar and logs
- No command-line knowledge required

## Command Line Usage

### Basic Usage

```bash
npm start -- --username your-username --token your-github-token --dir ./repos
```

### With Options

```bash
npm start -- \
  --username your-username \
  --token your-github-token \
  --dir ./client-websites \
  --private \
  --ssh \
  --filter "website"
```

### Interactive Mode

If you don't provide username or token, the tool will prompt you:

```bash
npm start -- --dir ./repos
```

## Options

- `-u, --username <username>` - GitHub username or organization name
- `-t, --token <token>` - GitHub personal access token (required for private repos)
- `-d, --dir <directory>` - Target directory (default: `./repos`)
- `--private` - Include private repositories
- `--ssh` - Use SSH URLs instead of HTTPS
- `--no-update` - Skip updating existing repositories
- `-f, --filter <filter>` - Filter repositories by name (case-insensitive)

## Getting a GitHub Token

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Select scopes:
   - `repo` (for private repositories)
   - `read:org` (for organization repositories)
4. Copy the token and use it with the `--token` option

## Examples

### Clone all public repos from a user

```bash
npm start -- -u octocat -d ./github-repos
```

### Clone all repos (including private) from your account

```bash
npm start -- -u your-username -t your-token --private -d ./all-repos
```

### Clone only repos with "website" in the name

```bash
npm start -- -u your-username -t your-token -f website -d ./websites
```

### Update existing repos (pull latest changes)

```bash
npm start -- -u your-username -t your-token -d ./existing-repos
```

## Notes

- Existing repositories will be updated (pulled) by default unless `--no-update` is used
- The tool creates the target directory if it doesn't exist
- Progress is shown for each repository
- Failed clones are reported at the end














