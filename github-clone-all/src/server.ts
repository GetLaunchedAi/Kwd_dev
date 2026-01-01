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
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.ts:18',message:'POST /api/clone endpoint called',data:{hasUsername:!!req.body.username,hasToken:!!req.body.token,directory:req.body.directory},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  const { username, token, directory, includePrivate, useSSH, updateExisting, filter } = req.body;

  if (!username || !token) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.ts:22',message:'Validation failed - missing username or token',data:{hasUsername:!!username,hasToken:!!token},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return res.status(400).json({ error: 'Username and token are required' });
  }

  const operationId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const progress: CloneProgress[] = [];
  activeOperations.set(operationId, { progress });

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.ts:28',message:'Starting background clone operation',data:{operationId,username,directory:directory||'./repos'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion

  // Start cloning in background
  (async () => {
    try {
      const progressCallback = (p: CloneProgress) => {
        progress.push(p);
      };

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.ts:35',message:'Creating GitHubCloneAll instance',data:{hasToken:!!token},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion

      const cloner = new GitHubCloneAll(token, progressCallback);
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.ts:40',message:'Calling cloneAll',data:{username,directory:directory||'./repos',includePrivate,useSSH,updateExisting,filter},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion

      const result = await cloner.cloneAll(username, directory || './repos', {
        includePrivate: includePrivate || false,
        useSSH: useSSH || false,
        updateExisting: updateExisting !== false,
        filter: filter || undefined,
      });

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.ts:50',message:'Clone operation completed successfully',data:{success:result.success,failed:result.failed,total:result.total},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion

      // Mark as complete
      progress.push({
        current: result.total,
        total: result.total,
        repoName: 'Complete',
        status: 'success',
        message: `Completed: ${result.success} succeeded, ${result.failed} failed`
      });
    } catch (error: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.ts:60',message:'Clone operation failed with error',data:{errorMessage:error.message,errorStack:error.stack,errorName:error.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion

      progress.push({
        current: 0,
        total: 0,
        repoName: 'Error',
        status: 'error',
        message: error.message
      });
    }
  })();

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.ts:66',message:'Sending response with operationId',data:{operationId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

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
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.ts:119',message:'Server started successfully',data:{port:PORT},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  console.log(`GitHub Clone All Web UI running at http://localhost:${PORT}`);
});

// #region agent log
process.on('uncaughtException', (error) => {
  fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.ts:125',message:'Uncaught exception - server may crash',data:{errorMessage:error.message,errorStack:error.stack,errorName:error.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
});

process.on('unhandledRejection', (reason, promise) => {
  fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.ts:129',message:'Unhandled promise rejection - server may crash',data:{reason:reason?.toString(),promise:promise?.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
});
// #endregion


