import * as vscode from 'vscode';
import { DSAgentClient } from '../api/client';
import { getNonce } from '../utils/nonce';
import type { AgentEvent, ChatMessage, HITLMode, PlanState, Turn } from '../api/types';

export class ChatPanelProvider {
    private _panel?: vscode.WebviewPanel;
    private messages: ChatMessage[] = [];
    private currentPlan: PlanState | null = null;
    private isThinking = false;
    private serverAvailable = false;
    private _pendingAction: 'loadHistory' | 'newChat' | null = null;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly client: DSAgentClient
    ) {
        this.setupClientListeners();
    }

    private setupClientListeners(): void {
        this.client.on('thinking', (event: AgentEvent) => {
            this.isThinking = true;
            this.postMessage({ type: 'thinking', content: event.content });
        });

        this.client.on('llm_response', (event: AgentEvent) => {
            if (event.content) {
                this.postMessage({ type: 'llm_response', content: event.content });
            }
        });

        this.client.on('plan', (event: AgentEvent) => {
            if (event.plan) {
                this.currentPlan = event.plan;
                this.postMessage({ type: 'plan', plan: event.plan });
            }
        });

        this.client.on('code_executing', (event: AgentEvent) => {
            this.postMessage({ type: 'codeExecuting', code: event.code });
        });

        this.client.on('code_result', (event: AgentEvent) => {
            this.postMessage({ type: 'codeResult', result: event.result });
        });

        this.client.on('answer', (event: AgentEvent) => {
            this.isThinking = false;
            this.postMessage({ type: 'answer', content: event.content });
        });

        this.client.on('error', (event: AgentEvent) => {
            this.isThinking = false;
            this.postMessage({ type: 'error', message: event.message });
        });

        this.client.on('complete', () => {
            this.isThinking = false;
            this.postMessage({ type: 'complete' });
        });

        this.client.on('hitl_request', (event: Record<string, unknown>) => {
            this.postMessage({
                type: 'hitlRequest',
                awaitingType: event.request_type || 'plan',
                plan: event.plan || null,
                code: event.code || null,
                error: event.error || null,
                answer: event.answer || null,
                message: event.message || null,
            });
        });

        this.client.on('connected', (sessionId: string) => {
            this.serverAvailable = true;
            this.postMessage({ type: 'connected', sessionId });
        });

        this.client.on('disconnected', () => {
            this.postMessage({ type: 'disconnected' });
        });

        this.client.on('serverAvailable', () => {
            this.serverAvailable = true;
            this.postMessage({ type: 'serverAvailable' });
        });
    }

    /**
     * Create or reveal the chat panel in ViewColumn.Beside.
     */
    public show(): void {
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            'dsagent.chatPanel',
            'DSAgent Chat',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist'),
                    vscode.Uri.joinPath(this.extensionUri, 'resources'),
                ],
            }
        );

        this._panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'icons', 'dsagent.svg');

        this._panel.webview.html = this.getHtmlForWebview(this._panel.webview);

        this._panel.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this.handleSendMessage(data.content);
                    break;
                case 'approve':
                    this.client.approveAction(data.feedback);
                    break;
                case 'reject':
                    this.client.rejectAction(data.reason);
                    break;
                case 'modify':
                    this.client.respondAction('modify', data.message, data.modification);
                    break;
                case 'attachFile':
                    await this.handleAttachFile();
                    break;
                case 'removeAttachedFile':
                    break;
                case 'ready':
                    this.syncState();
                    if (this._pendingAction === 'loadHistory') {
                        this._pendingAction = null;
                        await this.loadHistory();
                    } else if (this._pendingAction === 'newChat') {
                        this._pendingAction = null;
                        this.postMessage({ type: 'newChat' });
                    }
                    break;
            }
        });

        this._panel.onDidDispose(() => {
            this._panel = undefined;
        });
    }

    private async handleSendMessage(content: string): Promise<void> {
        const userMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            content,
            timestamp: new Date().toISOString(),
        };
        this.messages.push(userMessage);
        this.postMessage({ type: 'userMessage', message: userMessage });

        this.isThinking = true;
        this.postMessage({ type: 'thinking', content: 'Processing...' });

        if (!this.client.session) {
            try {
                await this.client.createSession();
            } catch (error) {
                this.isThinking = false;
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                this.postMessage({ type: 'error', message: `Failed to create session: ${errorMsg}` });
                vscode.window.showErrorMessage('Failed to create session. Is the server running?');
                return;
            }
        }

        try {
            await this.client.sendMessage(content);
            this.isThinking = false;
        } catch (error) {
            this.isThinking = false;
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            this.postMessage({ type: 'error', message: `Failed to send: ${errorMsg}` });
        }
    }

    private async handleAttachFile(): Promise<void> {
        const fileUris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            openLabel: 'Attach Files',
            filters: {
                'Data Files': ['csv', 'tsv', 'xlsx', 'xls', 'json', 'parquet', 'txt', 'md'],
                'All Files': ['*'],
            },
        });

        if (!fileUris || fileUris.length === 0) {
            return;
        }

        try {
            if (!this.client.session) {
                await this.client.createSession();
            }

            const uploadedNames: string[] = [];
            for (const fileUri of fileUris) {
                const fileName = fileUri.path.split('/').pop() || 'file';
                const fileData = await vscode.workspace.fs.readFile(fileUri);
                await this.client.uploadFile(fileName, fileData);
                uploadedNames.push(fileName);
            }

            this.postMessage({
                type: 'filesAttached',
                fileNames: uploadedNames,
            });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            this.postMessage({
                type: 'fileUploadError',
                message: `Failed to upload file: ${errorMsg}`,
            });
            vscode.window.showErrorMessage(`File upload failed: ${errorMsg}`);
        }
    }

    private async loadHistory(): Promise<void> {
        try {
            const { turns } = await this.client.getTurns();
            if (turns && turns.length > 0) {
                const historyMessages = this.turnsToMessages(turns);
                this.postMessage({ type: 'loadHistory', messages: historyMessages });
            }
        } catch (error) {
            console.error('Failed to load history:', error);
        }
    }

    private turnsToMessages(turns: Turn[]): Array<Record<string, unknown>> {
        const messages: Array<Record<string, unknown>> = [];

        for (const turn of turns) {
            if (turn.user_message) {
                messages.push({
                    id: `user-${turn.round}-${turn.timestamp}`,
                    type: 'user',
                    content: turn.user_message,
                    timestamp: turn.timestamp,
                });
            }

            if (turn.content) {
                messages.push({
                    id: `assistant-${turn.round}-${turn.timestamp}`,
                    type: 'assistant',
                    content: turn.content,
                    timestamp: turn.timestamp,
                    plan: turn.plan,
                    isStreaming: false,
                });
            }

            if (turn.code) {
                messages.push({
                    id: `code-${turn.round}-${turn.timestamp}`,
                    type: 'code',
                    content: turn.code,
                    code: turn.code,
                    timestamp: turn.timestamp,
                    codeStatus: turn.execution_result?.success ? 'success' : 'error',
                    executionResult: turn.execution_result ? {
                        success: turn.execution_result.success,
                        stdout: turn.execution_result.output || '',
                        stderr: '',
                        error: turn.execution_result.error,
                        images: turn.execution_result.images,
                    } : undefined,
                });
            }
        }

        return messages;
    }

    private syncState(): void {
        this.postMessage({
            type: 'syncState',
            messages: this.messages,
            plan: this.currentPlan,
            isThinking: this.isThinking,
            isConnected: this.client.isConnected,
            serverAvailable: this.serverAvailable,
            sessionId: this.client.session?.id,
        });
    }

    private postMessage(message: unknown): void {
        this._panel?.webview.postMessage(message);
    }

    public async startNewChat(name?: string, hitlMode?: HITLMode): Promise<void> {
        this.messages = [];
        this.currentPlan = null;
        this.isThinking = false;

        try {
            await this.client.createSession(name, undefined, hitlMode);
            if (this._panel) {
                this.postMessage({ type: 'newChat' });
            } else {
                this._pendingAction = 'newChat';
                this.show();
            }
        } catch (error) {
            this._pendingAction = null;
            vscode.window.showErrorMessage('Failed to start new chat');
        }
    }

    public async loadSession(sessionId: string): Promise<void> {
        try {
            this.messages = [];
            this.currentPlan = null;
            await this.client.resumeSession(sessionId);

            if (this._panel) {
                await this.loadHistory();
            } else {
                this._pendingAction = 'loadHistory';
                this.show();
            }
        } catch (error) {
            this._pendingAction = null;
            vscode.window.showErrorMessage('Failed to load session');
        }
    }

    public sendAnalysisRequest(text: string, context?: string): void {
        this.show();
        const prompt = context
            ? `Analyze this ${context}:\n\n${text}`
            : `Analyze this:\n\n${text}`;

        this.handleSendMessage(prompt);
    }

    public dispose(): void {
        this._panel?.dispose();
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist', 'assets', 'index.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist', 'assets', 'index.css')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
    <link rel="stylesheet" href="${styleUri}">
    <title>DSAgent Chat</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
