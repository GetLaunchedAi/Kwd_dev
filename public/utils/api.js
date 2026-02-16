// Centralized API client with error handling and retry logic

const API_BASE = '/api';

class ApiClient {
    constructor() {
        this.retryAttempts = 3;
        this.retryDelay = 1000;
    }

    async request(endpoint, options = {}) {
        const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
        
        // Add Authorization header if session token exists
        const token = localStorage.getItem('clickup_session_token');
        const authHeader = token ? { 'Authorization': `Bearer ${token}` } : {};

        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...authHeader,
                ...options.headers,
            },
            ...options,
        };

        let lastError;
        for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
            try {
                const response = await fetch(url, config);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    let errorData;
                    try {
                        errorData = JSON.parse(errorText);
                    } catch {
                        errorData = { error: errorText || `HTTP error! status: ${response.status}` };
                    }
                    
                    const error = new Error(errorData.error || `HTTP error! status: ${response.status}`);
                    error.status = response.status;
                    error.data = errorData; // Preserve full structured response for callers
                    
                    // Don't retry on 4xx errors (client errors) - throw immediately without retry
                    if (response.status >= 400 && response.status < 500) {
                        throw error;
                    }
                    
                    // For 5xx errors, store and continue to retry logic
                    lastError = error;
                    if (attempt < this.retryAttempts - 1) {
                        await this.delay(this.retryDelay * (attempt + 1));
                        continue;
                    }
                    throw error;
                }

                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    return await response.json();
                }
                return await response.text();
            } catch (error) {
                // Don't retry 4xx errors - they won't succeed on retry
                if (error.status && error.status >= 400 && error.status < 500) {
                    throw error;
                }
                
                lastError = error;
                
                // Don't retry on network errors if it's the last attempt
                if (attempt < this.retryAttempts - 1) {
                    await this.delay(this.retryDelay * (attempt + 1));
                    continue;
                }
                
                // Check if it's a network error
                if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                    throw new Error('Network error: Please check your connection and try again.');
                }
                
                throw error;
            }
        }
        
        throw lastError;
    }

    async get(endpoint, options = {}) {
        return this.request(endpoint, { ...options, method: 'GET' });
    }

    async post(endpoint, data, options = {}) {
        return this.request(endpoint, {
            ...options,
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async put(endpoint, data, options = {}) {
        return this.request(endpoint, {
            ...options,
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async patch(endpoint, data, options = {}) {
        return this.request(endpoint, {
            ...options,
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async delete(endpoint, data = null, options = {}) {
        // Support both api.delete('/endpoint') and api.delete('/endpoint', { body data })
        // If data is provided and is an object (not null), include it as JSON body
        const config = { ...options, method: 'DELETE' };
        if (data && typeof data === 'object') {
            config.body = JSON.stringify(data);
        }
        return this.request(endpoint, config);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export singleton instance
const api = new ApiClient();










