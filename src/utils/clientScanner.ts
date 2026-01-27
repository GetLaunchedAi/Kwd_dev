import * as fs from 'fs-extra';
import * as path from 'path';
import { config } from '../config/config';
import { logger } from './logger';
import { findAllTasks } from './taskScanner';

export interface ClientListItem {
  name: string;
  folder: string;
  taskCount: number;
  lastActivity?: string;
  activeTasks: number;
  hasGit: boolean;
  hasNodeModules: boolean;
  isNodeProject: boolean;
}

/**
 * Scans all client folders and finds all clients
 */
export async function findAllClients(): Promise<ClientListItem[]> {
  const clients: ClientListItem[] = [];
  const githubCloneAllDir = path.resolve(config.git.githubCloneAllDir || '');

  if (!fs.existsSync(githubCloneAllDir)) {
    logger.warn(`Github clone all directory does not exist: ${githubCloneAllDir}`);
    return clients;
  }

  try {
    const isAlreadyInClientWebsites = githubCloneAllDir.endsWith('client-websites') || 
                                     githubCloneAllDir.endsWith('client-websites' + path.sep);
    
    const searchDirs = Array.from(new Set([
      githubCloneAllDir,
      ...(isAlreadyInClientWebsites ? [] : [path.join(githubCloneAllDir, 'client-websites')])
    ])).filter(dir => fs.existsSync(dir));

    const tasks = await findAllTasks();
    const tasksByClient = tasks.reduce((acc, task) => {
      // Use clientName if available, otherwise use the last part of clientFolder
      const clientName = task.clientName || path.basename(task.clientFolder);
      if (!acc[clientName]) acc[clientName] = [];
      acc[clientName].push(task);
      return acc;
    }, {} as Record<string, any[]>);

    // Track which folders we've already processed
    const processedFolders = new Set<string>();

    for (const searchDir of searchDirs) {
      const entries = await fs.readdir(searchDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        // Skip hidden folders and common non-client folders
        if (entry.name.startsWith('.') || 
            ['node_modules', 'dist', 'src', 'public', 'tests', 'config', 'logs', 'scripts', 'agent', 'tokens', 'test-data', 'state', 'client-websites'].includes(entry.name)) {
          continue;
        }

        const clientFolder = path.join(searchDir, entry.name);
        if (processedFolders.has(clientFolder)) continue;
        processedFolders.add(clientFolder);

        // Defensive check: Ensure client folder still exists before scanning
        // (it could have been deleted during the async operations above)
        if (!await fs.pathExists(clientFolder)) {
          logger.debug(`Client folder disappeared during scan: ${clientFolder}`);
          continue;
        }

        // Check for Git and Node Modules with additional safety checks
        let hasGit = false;
        try {
          hasGit = await fs.pathExists(path.join(clientFolder, '.git'));
        } catch (err: any) {
          logger.debug(`Error checking .git for ${entry.name}: ${err.message}`);
        }
        
        // Node Modules check: more robust
        let hasNodeModules = false;
        let isNodeProject = false;
        const packageJsonPath = path.join(clientFolder, 'package.json');
        
        try {
          hasNodeModules = await fs.pathExists(path.join(clientFolder, 'node_modules'));
          isNodeProject = await fs.pathExists(packageJsonPath);
        } catch (err: any) {
          logger.debug(`Error checking node modules for ${entry.name}: ${err.message}`);
        }

        // Edge case: package.json exists but no node_modules. 
        // If there are no dependencies, then it's technically "installed" (nothing to install).
        if (!hasNodeModules && isNodeProject) {
          try {
            const pkg = await fs.readJson(packageJsonPath);
            const hasDeps = (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) || 
                           (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0);
            
            if (!hasDeps) {
              hasNodeModules = true;
            }
          } catch (err) {
            // If package.json is invalid, we can't be sure
          }
        }
        
        if (entry.name === 'aimai' || entry.name === 'jacks-roofing-llc') {
          logger.debug(`Client Scanner: ${entry.name} folder=${clientFolder}, hasGit=${hasGit}, isNodeProject=${isNodeProject}, hasNodeModules=${hasNodeModules}`);
        }

        const clientTasks = tasksByClient[entry.name] || [];
        
        let lastActivity = undefined;
        let activeTasks = 0;
        
        if (clientTasks.length > 0) {
          lastActivity = clientTasks.reduce((latest, task) => {
            const taskTime = new Date(task.updatedAt).getTime();
            return taskTime > latest ? taskTime : latest;
          }, 0);
          
          activeTasks = clientTasks.filter(t => 
            t.state === 'in_progress' || 
            t.state === 'awaiting_approval' || 
            t.state === 'testing'
          ).length;
        }

        clients.push({
          name: entry.name,
          folder: clientFolder,
          taskCount: clientTasks.length,
          activeTasks,
          lastActivity: lastActivity ? new Date(lastActivity).toISOString() : undefined,
          hasGit,
          hasNodeModules,
          isNodeProject
        });
      }
    }
  } catch (error: any) {
    logger.error(`Error scanning clients: ${error.message}`);
  }

  // Sort by active tasks first, then total task count, then name
  clients.sort((a, b) => {
    if (b.activeTasks !== a.activeTasks) return b.activeTasks - a.activeTasks;
    if (b.taskCount !== a.taskCount) return b.taskCount - a.taskCount;
    return a.name.localeCompare(b.name);
  });

  return clients;
}

