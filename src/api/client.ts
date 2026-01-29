import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';
import type {
    Session,
    ExecutionResult,
    KernelState,
    PlanState,
    Turn
} from './types';

export class DSAgentClient extends EventEmitter {
    private baseUrl: string;
    private apiKey: string | null = null;
    private currentSession: Session | null = null;
    private abortController: AbortController | null = null;
    private activeRequest: http.ClientRequest | null = null;

    constructor(baseUrl: string = 'http://localhost:8000') {
        super();
        this.baseUrl = baseUrl;
    }

    setApiKey(key: string): void {
        this.apiKey = key;
    }

    get isConnected(): boolean {
        return this.currentSession !== null;
    }

    get session(): Session | null {
        return this.currentSession;
    }

    // === Connection Management ===

    async connect(): Promise<boolean> {
        try {
            const response = await this.fetch('/health');
            if (response.ok) {
                this.emit('serverAvailable');
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    disconnect(): void {
        if (this.activeRequest) {
            this.activeRequest.destroy();
            this.activeRequest = null;
        }
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.currentSession = null;
        this.emit('disconnected');
    }

    // === Session Management ===

    async createSession(name?: string, model?: string): Promise<Session> {
        const response = await this.fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name || `Session ${new Date().toISOString()}`,
                model: model || 'gpt-4o',
                hitl_mode: 'none'
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to create session: ${error}`);
        }

        const session: Session = await response.json();
        this.currentSession = session;
        this.emit('sessionCreated', session);
        this.emit('connected', session.id);
        return session;
    }

    async listSessions(): Promise<Session[]> {
        const response = await this.fetch('/api/sessions');
        if (!response.ok) {
            return [];
        }
        const data = await response.json();
        if (Array.isArray(data)) {
            return data;
        }
        if (data && data.sessions) {
            return data.sessions;
        }
        return [];
    }

    async getSession(sessionId: string): Promise<Session> {
        const response = await this.fetch(`/api/sessions/${sessionId}`);
        if (!response.ok) {
            throw new Error('Session not found');
        }
        return response.json();
    }

    async resumeSession(sessionId: string): Promise<Session> {
        const session = await this.getSession(sessionId);
        this.currentSession = session;
        this.emit('sessionResumed', session);
        this.emit('connected', session.id);
        return session;
    }

    async deleteSession(sessionId: string): Promise<void> {
        const response = await this.fetch(`/api/sessions/${sessionId}`, {
            method: 'DELETE',
        });

        if (!response.ok) {
            throw new Error('Failed to delete session');
        }

        if (this.currentSession?.id === sessionId) {
            this.disconnect();
        }

        this.emit('sessionDeleted', sessionId);
    }

    // === Chat with SSE Streaming (native http for real-time delivery) ===

    async sendMessage(content: string): Promise<void> {
        if (!this.currentSession) {
            throw new Error('No active session');
        }

        // Abort any existing stream
        if (this.activeRequest) {
            this.activeRequest.destroy();
            this.activeRequest = null;
        }

        const parsedUrl = new URL(`${this.baseUrl}/api/sessions/${this.currentSession.id}/chat/stream`);
        const isHttps = parsedUrl.protocol === 'https:';
        const transport = isHttps ? https : http;
        const postData = JSON.stringify({ message: content });

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData).toString(),
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
        };
        if (this.apiKey) {
            headers['X-API-Key'] = this.apiKey;
        }

        return new Promise<void>((resolve, reject) => {
            const req = transport.request(
                {
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port || (isHttps ? 443 : 80),
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'POST',
                    headers,
                },
                (res) => {
                    if (res.statusCode && res.statusCode >= 400) {
                        let body = '';
                        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                        res.on('end', () => {
                            this.activeRequest = null;
                            this.emit('error', { type: 'error', message: `Chat request failed (${res.statusCode}): ${body}` });
                            resolve();
                        });
                        return;
                    }

                    let buffer = '';
                    let currentEventType = '';
                    let receivedDone = false;

                    res.on('data', (chunk: Buffer) => {
                        buffer += chunk.toString();
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.startsWith('event: ')) {
                                currentEventType = line.slice(7).trim();
                            } else if (line.startsWith('data: ')) {
                                const dataStr = line.slice(6);
                                if (dataStr) {
                                    try {
                                        const data = JSON.parse(dataStr);
                                        if (currentEventType === 'done') {
                                            receivedDone = true;
                                        }
                                        this.handleSSEEvent(currentEventType, data);
                                    } catch {
                                        // Ignore parse errors
                                    }
                                }
                            }
                        }
                    });

                    res.on('end', () => {
                        this.activeRequest = null;
                        if (!receivedDone) {
                            this.emit('complete', { type: 'complete' });
                        }
                        resolve();
                    });

                    res.on('error', (err: Error) => {
                        this.activeRequest = null;
                        this.emit('error', { type: 'error', message: err.message });
                        resolve();
                    });
                }
            );

            req.on('error', (err: Error) => {
                this.activeRequest = null;
                if (err.message === 'socket hang up') {
                    // Request was aborted intentionally
                    resolve();
                    return;
                }
                this.emit('error', { type: 'error', message: err.message });
                resolve();
            });

            this.activeRequest = req;
            req.write(postData);
            req.end();
        });
    }

    private handleSSEEvent(eventType: string, data: Record<string, unknown>): void {
        switch (eventType) {
            case 'thinking':
                this.emit('thinking', {
                    type: 'thinking',
                    content: data.message || 'Processing...'
                });
                break;

            case 'llm_response':
                this.emit('llm_response', {
                    type: 'llm_response',
                    content: data.content
                });
                break;

            case 'plan':
                const plan: PlanState = {
                    steps: (data.steps as Array<{ number: number; description: string; completed: boolean }>) || [],
                    raw_text: (data.raw_text as string) || '',
                    progress: `${data.completed_steps || 0}/${data.total_steps || 0}`,
                    total_steps: (data.total_steps as number) || 0
                };
                this.emit('plan', { type: 'plan', plan });
                break;

            case 'code_executing':
                this.emit('code_executing', {
                    type: 'code_executing',
                    code: data.code
                });
                break;

            case 'code_result':
                const result: ExecutionResult = {
                    success: (data.success as boolean) ?? true,
                    output: (data.stdout as string) || '',
                    error: data.error as string | undefined,
                    images: data.images as Array<{ mime: string; data: string }> | undefined
                };
                this.emit('code_result', { type: 'code_result', result });
                break;

            case 'round_complete':
                // Emit answer if present
                if (data.has_answer && data.answer) {
                    this.emit('answer', {
                        type: 'answer',
                        content: data.answer
                    });
                }
                break;

            case 'done':
                this.emit('complete', { type: 'complete' });
                break;

            case 'error':
                this.emit('error', {
                    type: 'error',
                    message: data.error || 'Unknown error'
                });
                break;

            case 'hitl_request':
                this.emit('hitl_request', {
                    type: 'hitl_request',
                    request_type: data.request_type,
                    plan: data.plan,
                    code: data.code,
                    error: data.error
                });
                break;
        }

        // Emit generic event for debugging
        this.emit('event', { type: eventType, ...data });
    }

    // === HITL Actions ===

    async approveAction(): Promise<void> {
        if (!this.currentSession) return;

        await this.fetch(`/api/sessions/${this.currentSession.id}/hitl/approve`, {
            method: 'POST',
        });
    }

    async rejectAction(): Promise<void> {
        if (!this.currentSession) return;

        await this.fetch(`/api/sessions/${this.currentSession.id}/hitl/reject`, {
            method: 'POST',
        });
    }

    async respondAction(action: string, message?: string, modification?: string): Promise<void> {
        if (!this.currentSession) return;

        await this.fetch(`/api/sessions/${this.currentSession.id}/hitl/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action,
                message,
                modified_plan: modification
            }),
        });
    }

    // === History / Turns ===

    async getTurns(sessionId?: string, limit: number = 50, offset: number = 0): Promise<{ turns: Turn[]; total: number; has_more: boolean }> {
        const id = sessionId || this.currentSession?.id;
        if (!id) {
            return { turns: [], total: 0, has_more: false };
        }

        try {
            const response = await this.fetch(`/api/sessions/${id}/turns?limit=${limit}&offset=${offset}`);
            if (!response.ok) {
                return { turns: [], total: 0, has_more: false };
            }
            return response.json();
        } catch {
            return { turns: [], total: 0, has_more: false };
        }
    }

    // === Session Notebook ===

    async downloadNotebook(): Promise<Uint8Array> {
        if (!this.currentSession) {
            throw new Error('No active session');
        }

        const response = await this.fetch(
            `/api/sessions/${this.currentSession.id}/notebook`
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to download notebook: ${error}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    }

    // === Code Execution ===

    async executeCode(code: string): Promise<ExecutionResult> {
        if (!this.currentSession) {
            throw new Error('No active session');
        }

        const response = await this.fetch(
            `/api/sessions/${this.currentSession.id}/kernel/execute`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Code execution failed: ${error}`);
        }

        return response.json();
    }

    // === Kernel State ===

    async getKernelState(): Promise<KernelState | null> {
        if (!this.currentSession) {
            return null;
        }

        try {
            const response = await this.fetch(
                `/api/sessions/${this.currentSession.id}/kernel`
            );

            if (!response.ok) {
                return null;
            }

            return response.json();
        } catch {
            return null;
        }
    }

    // === File Upload ===

    async uploadFile(fileName: string, fileBuffer: Uint8Array, category: string = 'data'): Promise<{ filename: string }> {
        if (!this.currentSession) {
            throw new Error('No active session');
        }

        const boundary = `----FormBoundary${Date.now().toString(36)}`;
        const header = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
        const footer = `\r\n--${boundary}--\r\n`;

        const headerBytes = new TextEncoder().encode(header);
        const footerBytes = new TextEncoder().encode(footer);
        const body = new Uint8Array(headerBytes.length + fileBuffer.length + footerBytes.length);
        body.set(headerBytes, 0);
        body.set(fileBuffer, headerBytes.length);
        body.set(footerBytes, headerBytes.length + fileBuffer.length);

        const url = `${this.baseUrl}/api/sessions/${this.currentSession.id}/files?category=${encodeURIComponent(category)}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                ...(this.apiKey && { 'X-API-Key': this.apiKey }),
            },
            body: body,
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`File upload failed: ${error}`);
        }

        return response.json();
    }

    // === Helper ===

    private async fetch(path: string, options?: RequestInit): Promise<Response> {
        const url = `${this.baseUrl}${path}`;
        return fetch(url, {
            ...options,
            headers: {
                ...options?.headers,
                ...(this.apiKey && { 'X-API-Key': this.apiKey }),
            },
        });
    }
}
