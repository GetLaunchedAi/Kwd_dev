/**
 * Log Formatter Utility
 * 
 * Transforms raw cursor-agent events into human-readable log messages
 * for display in the demo creation UI.
 */

/**
 * Tool name to human-readable description mappings
 */
const TOOL_DESCRIPTIONS: Record<string, (args: any) => string> = {
  // File system operations
  lsToolCall: (args) => {
    const path = getRelativePath(args?.path || args?.directory || '.');
    return `Exploring ${path || 'project structure'}`;
  },
  list_dir: (args) => {
    const path = getRelativePath(args?.path || args?.target_directory || '.');
    return `Exploring ${path || 'project structure'}`;
  },
  readToolCall: (args) => {
    const file = getRelativePath(args?.path || args?.target_file || args?.file || 'file');
    return `Reading ${file}`;
  },
  read_file: (args) => {
    const file = getRelativePath(args?.path || args?.target_file || args?.file || 'file');
    return `Reading ${file}`;
  },
  editToolCall: (args) => {
    const file = getRelativePath(args?.path || args?.target_file || args?.file || 'file');
    return `Editing ${file}`;
  },
  edit_file: (args) => {
    const file = getRelativePath(args?.path || args?.target_file || args?.file || 'file');
    return `Editing ${file}`;
  },
  search_replace: (args) => {
    const file = getRelativePath(args?.file_path || args?.path || 'file');
    return `Editing ${file}`;
  },
  writeToolCall: (args) => {
    const file = getRelativePath(args?.path || args?.target_file || args?.file || 'file');
    return `Creating ${file}`;
  },
  write: (args) => {
    const file = getRelativePath(args?.file_path || args?.path || args?.file || 'file');
    return `Creating ${file}`;
  },
  
  // Terminal operations
  terminalToolCall: (args) => {
    const cmd = args?.command || args?.cmd || 'command';
    // Truncate long commands
    const shortCmd = cmd.length > 60 ? cmd.substring(0, 57) + '...' : cmd;
    return `Running: ${shortCmd}`;
  },
  run_terminal_cmd: (args) => {
    const cmd = args?.command || args?.cmd || 'command';
    const shortCmd = cmd.length > 60 ? cmd.substring(0, 57) + '...' : cmd;
    return `Running: ${shortCmd}`;
  },
  
  // Search operations
  searchToolCall: (_args) => 'Searching codebase',
  codebase_search: (args) => {
    const query = args?.query;
    if (query && query.length <= 40) {
      return `Searching: "${query}"`;
    }
    return 'Searching codebase';
  },
  grep: (args) => {
    const pattern = args?.pattern;
    if (pattern && pattern.length <= 30) {
      return `Searching for: ${pattern}`;
    }
    return 'Searching files';
  },
  
  // File search
  file_search: (args) => {
    const query = args?.query || args?.pattern;
    if (query) {
      return `Finding files: ${query}`;
    }
    return 'Finding files';
  },
  glob_file_search: (args) => {
    const pattern = args?.glob_pattern || args?.pattern;
    if (pattern) {
      return `Finding files: ${pattern}`;
    }
    return 'Finding files';
  },
  
  // Web/browser operations
  web_search: (args) => {
    const term = args?.search_term || args?.query;
    if (term && term.length <= 40) {
      return `Searching web: "${term}"`;
    }
    return 'Searching the web';
  },
};

/**
 * Tool types that should be skipped on completion (read-only operations)
 * These are noisy and don't represent meaningful progress
 */
const SKIP_ON_COMPLETE = new Set([
  'lsToolCall',
  'list_dir',
  'readToolCall',
  'read_file',
  'searchToolCall',
  'codebase_search',
  'grep',
  'file_search',
  'glob_file_search',
  'web_search',
]);

/**
 * Extracts a short relative path from a potentially full absolute path.
 * Returns just the filename and parent directory for brevity.
 * 
 * @param fullPath - Full or partial file path
 * @returns Short relative path (e.g., "src/index.html")
 */
export function getRelativePath(fullPath: string): string {
  if (!fullPath || fullPath === '.') return '';
  
  // Normalize path separators
  const normalized = fullPath.replace(/\\/g, '/');
  
  // Remove common prefixes that make paths too long
  const prefixesToRemove = [
    /^[A-Za-z]:[\/\\]/,           // Windows drive letters (C:/, D:\)
    /^\/home\/[^\/]+\//,          // Linux home dirs
    /^\/Users\/[^\/]+\//,         // macOS home dirs
    /^.*?\/client-websites\//,    // Our project structure
    /^.*?\/Kwd_dev\//,            // Project root
  ];
  
  let cleanPath = normalized;
  for (const prefix of prefixesToRemove) {
    cleanPath = cleanPath.replace(prefix, '');
  }
  
  // If still too long, take just the last 2 path components
  const parts = cleanPath.split('/').filter(Boolean);
  if (parts.length > 3) {
    return parts.slice(-2).join('/');
  }
  
  return cleanPath || fullPath;
}

/**
 * Formats a tool_call "started" event into a human-readable string.
 * 
 * @param toolName - The name of the tool being invoked
 * @param args - Arguments passed to the tool
 * @returns Human-readable description of what the agent is doing
 */
export function formatToolStart(toolName: string, args: any): string {
  const formatter = TOOL_DESCRIPTIONS[toolName];
  if (formatter) {
    return formatter(args || {});
  }
  
  // Fallback for unknown tools - make them more readable
  const readableName = toolName
    .replace(/ToolCall$/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase();
  
  return `Using ${readableName || toolName}`;
}

/**
 * Formats a tool_call "completed" event into a human-readable string.
 * Returns null if the event should be skipped (e.g., read-only operations).
 * 
 * @param toolName - The name of the tool that completed
 * @param result - The result of the tool execution
 * @returns Human-readable completion message, or null to skip
 */
export function formatToolComplete(toolName: string, result: any): string | null {
  // Skip read-only operations on completion - they're noisy
  if (SKIP_ON_COMPLETE.has(toolName)) {
    return null;
  }
  
  // For write/edit operations, show what was modified
  if (toolName === 'editToolCall' || toolName === 'edit_file' || toolName === 'search_replace') {
    const file = getRelativePath(result?.path || result?.file_path || result?.file || '');
    if (file) {
      return `Updated ${file}`;
    }
    return 'Updated file';
  }
  
  if (toolName === 'writeToolCall' || toolName === 'write') {
    const file = getRelativePath(result?.path || result?.file_path || result?.file || '');
    if (file) {
      return `Created ${file}`;
    }
    return 'Created file';
  }
  
  if (toolName === 'terminalToolCall' || toolName === 'run_terminal_cmd') {
    // Only show completion for terminal commands if they had meaningful output
    return 'Command completed';
  }
  
  // For other tools, return a generic completion message
  return null;
}

/**
 * Determines if a log event should be shown to the user.
 * Filters out streaming chunks, internal events, and noise.
 * 
 * @param log - The raw log event object
 * @returns true if the event should be shown, false to filter it out
 */
export function shouldShowEvent(log: any): boolean {
  if (!log) return false;
  
  // Skip thinking deltas (streaming chunks)
  if (log.type === 'thinking' && log.subtype === 'delta') {
    return false;
  }
  
  // Skip user messages (initial instruction)
  if (log.type === 'user') {
    return false;
  }
  
  // Skip internal bash setup messages
  if (typeof log.line === 'string') {
    if (log.line.includes('BASH_STARTING') || log.line.includes('BASH_ENV_READY')) {
      return false;
    }
  }
  
  // Skip assistant streaming chunks (short fragments)
  if (log.type === 'assistant' && log.message?.content?.[0]?.text) {
    const text = log.message.content[0].text.trim();
    // Streaming chunks are typically short and don't form complete sentences
    if (text.length < 80 && !text.startsWith('##') && !text.endsWith('.') && !text.endsWith(':')) {
      return false;
    }
  }
  
  return true;
}

/**
 * Main function to format a log entry into a human-readable string.
 * Returns null if the entry should be filtered out.
 * 
 * @param log - Raw log event from cursor-agent
 * @returns Formatted log string, or null to filter out
 */
export function formatLogEntry(log: any): string | null {
  if (!shouldShowEvent(log)) {
    return null;
  }
  
  // System init event
  if (log.type === 'system' && log.subtype === 'init') {
    const model = log.model || 'AI';
    return `Agent started (${model})`;
  }
  
  // Thinking completed - agent made a decision
  if (log.type === 'thinking' && log.subtype === 'completed') {
    return 'Planning next action...';
  }
  
  // Tool call started
  if (log.type === 'tool_call' && log.subtype === 'started') {
    const toolCall = log.tool_call || {};
    const toolName = Object.keys(toolCall)[0];
    if (toolName) {
      const args = toolCall[toolName];
      return formatToolStart(toolName, args);
    }
    return 'Using tool...';
  }
  
  // Tool call completed
  if (log.type === 'tool_call' && log.subtype === 'completed') {
    const toolCall = log.tool_call || {};
    const toolName = Object.keys(toolCall)[0];
    if (toolName) {
      const result = toolCall[toolName];
      return formatToolComplete(toolName, result);
    }
    return null;
  }
  
  // Result success - task completed
  if (log.type === 'result' && log.subtype === 'success') {
    // Extract meaningful summary from result
    if (log.result) {
      const resultText = String(log.result).trim();
      const lines = resultText.split('\n').filter((l: string) => l.trim());
      if (lines.length > 0) {
        // Find the first meaningful line
        const meaningfulLine = lines.find((l: string) => l.trim().length > 10) || lines[0];
        let message = meaningfulLine.trim();
        if (message.length > 120) {
          message = message.substring(0, 117) + '...';
        }
        return message;
      }
    }
    return 'Task completed';
  }
  
  // Result error
  if (log.type === 'result' && log.subtype === 'error') {
    const errorMsg = log.error || log.message || 'An error occurred';
    return `Error: ${errorMsg.substring(0, 100)}`;
  }
  
  // Assistant message (substantial content only - streaming filtered by shouldShowEvent)
  if (log.type === 'assistant' && log.message?.content?.[0]?.text) {
    const text = log.message.content[0].text.trim();
    const firstLine = text.split('\n')[0];
    if (firstLine.length > 120) {
      return firstLine.substring(0, 117) + '...';
    }
    return firstLine;
  }
  
  // Simple string log entries
  if (log.line && typeof log.line === 'string') {
    const line = log.line.trim();
    if (line && !line.includes('BASH_')) {
      return line.length > 120 ? line.substring(0, 117) + '...' : line;
    }
  }
  
  // Step information
  if (log.step && typeof log.step === 'string') {
    return log.step;
  }
  
  // Fallback: skip unrecognized events
  return null;
}

/**
 * Formats a timestamp into a locale time string.
 * 
 * @param timestamp - ISO timestamp or Date object
 * @returns Formatted time string (e.g., "2:30:45 PM")
 */
export function formatTimestamp(timestamp: string | Date | undefined): string {
  if (!timestamp) {
    return new Date().toLocaleTimeString();
  }
  try {
    return new Date(timestamp).toLocaleTimeString();
  } catch {
    return new Date().toLocaleTimeString();
  }
}


