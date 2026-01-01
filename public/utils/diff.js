// Enhanced diff parsing and rendering utilities

const DiffUtils = {
    /**
     * Parse unified diff text into structured format
     */
    parseDiff(diffText) {
        if (!diffText) return [];

        const files = [];
        const lines = diffText.split('\n');
        let currentFile = null;
        let currentLines = [];
        let oldPath = null;
        let newPath = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Start of a new file diff
            if (line.startsWith('diff --git')) {
                // Save previous file
                if (currentFile) {
                    files.push({
                        ...currentFile,
                        lines: currentLines,
                    });
                }

                const match = line.match(/diff --git a\/(.+?) b\/(.+?)$/);
                oldPath = match ? match[1] : null;
                newPath = match ? match[2] : null;

                currentFile = {
                    path: newPath || oldPath || 'unknown',
                    oldPath: oldPath,
                    newPath: newPath,
                    lines: [],
                };
                currentLines = [];
            }
            // File paths
            else if (line.startsWith('---')) {
                const match = line.match(/^--- (.+?)(?:\s|$)/);
                if (match && currentFile) {
                    currentFile.oldPath = match[1];
                }
            } else if (line.startsWith('+++')) {
                const match = line.match(/^\+\+\+ (.+?)(?:\s|$)/);
                if (match && currentFile) {
                    currentFile.newPath = match[1];
                    currentFile.path = match[1].replace(/^b\//, '');
                }
            }
            // Hunk header
            else if (line.startsWith('@@')) {
                const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
                if (hunkMatch && currentFile) {
                    currentLines.push({
                        type: 'hunk',
                        content: line,
                        oldStart: parseInt(hunkMatch[1]),
                        oldLines: parseInt(hunkMatch[2] || '1'),
                        newStart: parseInt(hunkMatch[3]),
                        newLines: parseInt(hunkMatch[4] || '1'),
                    });
                }
            }
            // Added line
            else if (line.startsWith('+') && !line.startsWith('+++')) {
                currentLines.push({
                    type: 'added',
                    content: line.substring(1),
                });
            }
            // Removed line
            else if (line.startsWith('-') && !line.startsWith('---')) {
                currentLines.push({
                    type: 'removed',
                    content: line.substring(1),
                });
            }
            // Context line
            else if (line.startsWith(' ')) {
                currentLines.push({
                    type: 'context',
                    content: line.substring(1),
                });
            }
            // Other (usually empty or metadata)
            else {
                currentLines.push({
                    type: 'context',
                    content: line,
                });
            }
        }

        // Add last file
        if (currentFile) {
            files.push({
                ...currentFile,
                lines: currentLines,
            });
        }

        return files;
    },

    /**
     * Get file extension for syntax highlighting
     */
    getFileExtension(filePath) {
        if (!filePath) return '';
        const parts = filePath.split('.');
        return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
    },

    /**
     * Check if file is likely a code file
     */
    isCodeFile(filePath) {
        const codeExtensions = [
            'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'cs', 'php',
            'rb', 'go', 'rs', 'swift', 'kt', 'scala', 'clj', 'sh', 'bash',
            'html', 'css', 'scss', 'sass', 'less', 'xml', 'json', 'yaml',
            'yml', 'md', 'sql', 'vue', 'svelte', 'dart', 'lua', 'r',
        ];
        const ext = this.getFileExtension(filePath);
        return codeExtensions.includes(ext);
    },

    /**
     * Get language for syntax highlighting based on file extension
     */
    getLanguage(filePath) {
        const ext = this.getFileExtension(filePath);
        const languageMap = {
            'js': 'javascript',
            'jsx': 'javascript',
            'ts': 'typescript',
            'tsx': 'typescript',
            'py': 'python',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'cs': 'csharp',
            'php': 'php',
            'rb': 'ruby',
            'go': 'go',
            'rs': 'rust',
            'swift': 'swift',
            'kt': 'kotlin',
            'html': 'html',
            'css': 'css',
            'scss': 'scss',
            'sass': 'sass',
            'less': 'less',
            'xml': 'xml',
            'json': 'json',
            'yaml': 'yaml',
            'yml': 'yaml',
            'md': 'markdown',
            'sql': 'sql',
            'vue': 'vue',
            'sh': 'bash',
            'bash': 'bash',
        };
        return languageMap[ext] || 'text';
    },

    /**
     * Escape HTML for safe rendering
     */
    escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Highlight syntax in code (basic implementation)
     * For a full implementation, you'd use a library like Prism.js or highlight.js
     */
    highlightSyntax(code, language) {
        // Basic syntax highlighting - in production, use a proper library
        // This is a placeholder that escapes HTML
        return this.escapeHtml(code);
    },
};










