# GitHub Actions & Secrets Setup

This guide explains how to configure the GitHub Repository Secrets required for the automated deployment workflow defined in `.github/workflows/deploy.yml`.

## Secrets Configuration

Based on your organization's existing secrets, we have aligned the workflow to use them where possible.

### 1. Existing Organization Secrets (Reused)

The workflow is configured to use these if they are already set in your GitHub Organization or Repository secrets:

| Secret Name | Description | Note |
|-------------|-------------|------|
| `CLOUDWAYS_HOST` | The public IP address of your Cloudways server. | **Verify** this points to the correct server. |
| `CLOUDWAYS_USER` | The SSH master username. | **Important:** Ensure this is the **SSH Master Username** (e.g., `master_xxxx`), NOT your Cloudways email address. |

### 2. New Secrets to Add (Required)

You need to add these specifically for this repository:

| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `CLOUD_SSH_KEY` | The **private** SSH key used to authenticate with the server. | `-----BEGIN OPENSSH PRIVATE KEY----- ...` |

> **Note:** The Application Name (`qqmunqdbbw`) has been hardcoded in the deployment script.

---

## Step 1: SSH Key Setup

You need a dedicated SSH key pair for GitHub Actions to authenticate with your Cloudways server.

### Check for Existing Keys
You may already have SSH keys in your `%USERPROFILE%/.ssh/` directory (e.g., `id_rsa`, `id_ed25519`).

If you want to use an **existing key**:
1.  **Public Key:** Ensure the content of the `.pub` file (e.g., `id_rsa.pub`) is added to your Cloudways server (Security -> SSH Public Keys).
2.  **Private Key:** Copy the content of the private key file (e.g., `id_rsa` - *no extension*) and add it as the `CLOUD_SSH_KEY` secret in GitHub.

If you need to **generate a new key**:
1.  Open your terminal.
2.  Run: `ssh-keygen -t ed25519 -C "github-actions-deploy" -f github_deploy_key`
3.  Add `github_deploy_key.pub` to Cloudways.
4.  Add `github_deploy_key` content to GitHub Secrets.

---

## Step 2: Configure Cloudways (Public Key)

1.  Log in to your **Cloudways Platform**.
2.  Navigate to **Servers** and select your target server.
3.  Go to **Security** -> **SSH Public Keys**.
4.  Click **Add Label**, give it a name, and paste your **Public Key**.
5.  Click **Submit**.

---

## Step 3: Configure GitHub Secrets (Private Key)

1.  Go to your GitHub repository.
2.  Navigate to **Settings** > **Secrets and variables** > **Actions**.
3.  Click **New repository secret**.
4.  Add the secret:

    ### `CLOUD_SSH_KEY`
    - **Value:** The content of your **Private Key** file.
    - *Important:* Include the header and footer:
      ```text
      -----BEGIN OPENSSH PRIVATE KEY-----
      ... key content ...
      -----END OPENSSH PRIVATE KEY-----
      ```

---

## Troubleshooting

- **Authentication Failed:**
  - Check if `CLOUDWAYS_USER` is actually the SSH username (`master_...`) and not an email.
  - Ensure the Public Key was correctly added to Cloudways.

