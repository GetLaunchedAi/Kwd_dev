import express from 'express';
import cors from 'cors';
import * as path from 'path';
import axios from 'axios';
import { GitHubCloneAll, CloneProgress } from './githubCloner';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Store active operations
const activeOperations = new Map<string, { progress: CloneProgress[] }>();

// API endpoint to start cloning
app.post('/api/clone', async (req, res) => {

  const { username, token, directory, includePrivate, useSSH, updateExisting, filter } = req.body;

  if (!username || !token) {
    return res.status(400).json({ error: 'Username and token are required' });
  }

  const operationId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const progress: CloneProgress[] = [];
  activeOperations.set(operationId, { progress });


  // Start cloning in background
  (async () => {
    try {
      const progressCallback = (p: CloneProgress) => {
        progress.push(p);
      };


      const cloner = new GitHubCloneAll(token, progressCallback);
      

      const result = await cloner.cloneAll(username, directory || './repos', {
        includePrivate: includePrivate || false,
        useSSH: useSSH || false,
        updateExisting: updateExisting !== false,
        filter: filter || undefined,
      });


      // Mark as complete
      progress.push({
        current: result.total,
        total: result.total,
        repoName: 'Complete',
        status: 'success',
        message: `Completed: ${result.success} succeeded, ${result.failed} failed`
      });
    } catch (error: any) {

      progress.push({
        current: 0,
        total: 0,
        repoName: 'Error',
        status: 'error',
        message: error.message
      });
    }
  })();


  res.json({ operationId });
});

// API endpoint to get progress
app.get('/api/progress/:operationId', (req, res) => {
  const { operationId } = req.params;
  const operation = activeOperations.get(operationId);

  if (!operation) {
    return res.status(404).json({ error: 'Operation not found' });
  }

  res.json({ progress: operation.progress });
});

// API endpoint to resolve directory path
app.post('/api/resolve-path', (req, res) => {
  const { directory } = req.body;
  const resolvedPath = path.resolve(directory || './repos');
  res.json({ path: resolvedPath });
});

// API endpoint to test token
app.post('/api/test-token', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    const response = await axios.get('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    res.json({ 
      valid: true, 
      username: response.data.login,
      name: response.data.name 
    });
  } catch (error: any) {
    res.status(401).json({ 
      valid: false, 
      error: error.response?.status === 401 ? 'Invalid token' : error.message 
    });
  }
});

// Serve the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`GitHub Clone All Web UI running at http://localhost:${PORT}`);
});



