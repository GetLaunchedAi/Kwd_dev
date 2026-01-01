#!/usr/bin/env node

import { Command } from 'commander';
import * as chalk from 'chalk';
import inquirer from 'inquirer';
import { GitHubCloneAll } from './githubCloner';

async function main() {
  const program = new Command();

  program
    .name('github-clone-all')
    .description('Clone all repositories from a GitHub account into a folder')
    .version('1.0.0')
    .option('-u, --username <username>', 'GitHub username or organization')
    .option('-t, --token <token>', 'GitHub personal access token')
    .option('-d, --dir <directory>', 'Target directory to clone repositories into', './repos')
    .option('--private', 'Include private repositories', false)
    .option('--ssh', 'Use SSH URLs instead of HTTPS', false)
    .option('--no-update', 'Skip updating existing repositories', false)
    .option('-f, --filter <filter>', 'Filter repositories by name (case-insensitive)')
    .action(async (options) => {
      let username = options.username;
      let token = options.token;

      // Prompt for username if not provided
      if (!username) {
        const answer = await inquirer.prompt([
          {
            type: 'input',
            name: 'username',
            message: 'GitHub username or organization:',
            validate: (input: string) => input.length > 0 || 'Username is required',
          },
        ]);
        username = answer.username;
      }

      // Prompt for token if not provided
      if (!token) {
        const answer = await inquirer.prompt([
          {
            type: 'password',
            name: 'token',
            message: 'GitHub personal access token:',
            validate: (input: string) => input.length > 0 || 'Token is required',
          },
        ]);
        token = answer.token;
      }

      const cloner = new GitHubCloneAll(token, (progress) => {
        const statusEmoji = progress.status === 'success' ? '✓' : progress.status === 'error' ? '✗' : '⟳';
        console.log(chalk.gray(`[${progress.current}/${progress.total}] ${statusEmoji} ${progress.repoName} ${progress.message || ''}`));
      });

      try {
        const result = await cloner.cloneAll(username, options.dir, {
          includePrivate: options.private,
          useSSH: options.ssh,
          updateExisting: !options.noUpdate,
          filter: options.filter,
        });
        console.log(chalk.green(`\n✓ Successfully cloned/updated: ${result.success}`));
        if (result.failed > 0) {
          console.log(chalk.red(`✗ Failed: ${result.failed}`));
        }
      } catch (error: any) {
        console.error(chalk.red(`\nError: ${error.message}`));
        process.exit(1);
      }
    });

  program.parse();
}

if (require.main === module) {
  main().catch(console.error);
}




