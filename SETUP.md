# DSAgent VS Code Extension - Setup Guide

## Quick Start

Cuando abras Claude en este directorio, puedes pedirle:

```
Crea la estructura inicial del proyecto dsagent-vscode basándote en el plan en este archivo.
```

---

## Project Structure to Create

```
dsagent-vscode/
├── .vscode/
│   ├── launch.json              # Debug configuration
│   ├── tasks.json               # Build tasks
│   └── extensions.json          # Recommended extensions
├── src/
│   ├── extension.ts             # Entry point
│   ├── api/
│   │   ├── client.ts            # DSAgent API client
│   │   ├── types.ts             # TypeScript interfaces
│   │   └── websocket.ts         # WebSocket handler
│   ├── providers/
│   │   ├── chatViewProvider.ts  # Sidebar chat panel
│   │   ├── sessionsTreeProvider.ts # Sessions tree view
│   │   ├── variablesTreeProvider.ts # Variables inspector
│   │   └── notebookController.ts # Notebook kernel (Phase 2)
│   ├── commands/
│   │   └── index.ts             # Command registration
│   ├── services/
│   │   └── statusBar.ts         # Status bar manager
│   └── utils/
│       └── nonce.ts             # Security utilities
├── webview-ui/                  # React app for chat panel
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── App.css
│       ├── vscode.ts            # VS Code API wrapper
│       └── components/
│           ├── ChatInput.tsx
│           ├── ChatMessage.tsx
│           ├── CodeBlock.tsx
│           ├── PlanView.tsx
│           └── ThinkingIndicator.tsx
├── resources/
│   └── icons/
│       └── dsagent.svg
├── package.json                 # Extension manifest
├── tsconfig.json
├── esbuild.js                   # Build script
├── .gitignore
├── README.md
└── CHANGELOG.md
```

---

## Phase 1: MVP - Files to Create

### 1. package.json

```json
{
  "name": "dsagent",
  "displayName": "DSAgent - AI Data Science Assistant",
  "description": "AI-powered data science agent for VS Code. Analyze data, create visualizations, and build models with natural language.",
  "version": "0.1.0",
  "publisher": "aiudalabs",
  "repository": {
    "type": "git",
    "url": "https://github.com/aiudalabs/dsagent-vscode"
  },
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": [
    "Data Science",
    "Machine Learning",
    "Notebooks",
    "Chat"
  ],
  "keywords": [
    "data science",
    "ai",
    "machine learning",
    "jupyter",
    "pandas",
    "python"
  ],
  "activationEvents": [
    "onLanguage:python",
    "onNotebook:jupyter-notebook"
  ],
  "main": "./dist/extension.js",
  "icon": "resources/icons/dsagent.png",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "dsagent",
          "title": "DSAgent",
          "icon": "resources/icons/dsagent.svg"
        }
      ]
    },
    "views": {
      "dsagent": [
        {
          "type": "webview",
          "id": "dsagent.chatView",
          "name": "Chat"
        },
        {
          "id": "dsagent.sessionsView",
          "name": "Sessions"
        },
        {
          "id": "dsagent.variablesView",
          "name": "Variables"
        }
      ]
    },
    "commands": [
      {
        "command": "dsagent.startChat",
        "title": "Start New Chat",
        "category": "DSAgent",
        "icon": "$(comment-discussion)"
      },
      {
        "command": "dsagent.connectServer",
        "title": "Connect to Server",
        "category": "DSAgent",
        "icon": "$(plug)"
      },
      {
        "command": "dsagent.disconnectServer",
        "title": "Disconnect from Server",
        "category": "DSAgent",
        "icon": "$(debug-disconnect)"
      },
      {
        "command": "dsagent.analyzeSelection",
        "title": "Analyze with DSAgent",
        "category": "DSAgent",
        "icon": "$(sparkle)"
      },
      {
        "command": "dsagent.analyzeFile",
        "title": "Analyze File with DSAgent",
        "category": "DSAgent",
        "icon": "$(sparkle)"
      },
      {
        "command": "dsagent.refreshSessions",
        "title": "Refresh Sessions",
        "category": "DSAgent",
        "icon": "$(refresh)"
      }
    ],
    "menus": {
      "editor/context": [
        {
          "command": "dsagent.analyzeSelection",
          "when": "editorHasSelection && editorLangId == python",
          "group": "dsagent@1"
        }
      ],
      "explorer/context": [
        {
          "command": "dsagent.analyzeFile",
          "when": "resourceExtname == .csv || resourceExtname == .xlsx || resourceExtname == .json || resourceExtname == .parquet",
          "group": "dsagent@1"
        }
      ],
      "view/title": [
        {
          "command": "dsagent.startChat",
          "when": "view == dsagent.chatView",
          "group": "navigation"
        },
        {
          "command": "dsagent.refreshSessions",
          "when": "view == dsagent.sessionsView",
          "group": "navigation"
        }
      ]
    },
    "configuration": {
      "title": "DSAgent",
      "properties": {
        "dsagent.serverUrl": {
          "type": "string",
          "default": "http://localhost:8000",
          "description": "DSAgent server URL"
        },
        "dsagent.autoConnect": {
          "type": "boolean",
          "default": true,
          "description": "Automatically connect to server on startup"
        },
        "dsagent.model": {
          "type": "string",
          "default": "gpt-4o",
          "enum": [
            "gpt-4o",
            "gpt-4o-mini",
            "claude-sonnet-4-20250514",
            "claude-opus-4-20250514",
            "gemini-2.0-flash",
            "gemini-2.5-pro"
          ],
          "description": "Default LLM model to use"
        },
        "dsagent.showThinking": {
          "type": "boolean",
          "default": true,
          "description": "Show thinking indicator while agent is processing"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run build",
    "build": "npm run build:webview && node esbuild.js --production",
    "build:webview": "cd webview-ui && npm run build",
    "watch": "node esbuild.js --watch",
    "watch:webview": "cd webview-ui && npm run dev",
    "dev": "concurrently \"npm run watch\" \"npm run watch:webview\"",
    "lint": "eslint src --ext ts",
    "test": "node ./out/test/runTest.js",
    "package": "vsce package",
    "publish": "vsce publish"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/vscode": "^1.85.0",
    "@types/ws": "^8.5.10",
    "@typescript-eslint/eslint-plugin": "^6.13.0",
    "@typescript-eslint/parser": "^6.13.0",
    "@vscode/vsce": "^2.22.0",
    "concurrently": "^8.2.0",
    "esbuild": "^0.19.8",
    "eslint": "^8.55.0",
    "typescript": "^5.3.0"
  },
  "dependencies": {
    "ws": "^8.14.0"
  }
}
```

### 2. tsconfig.json

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "webview-ui"]
}
```

### 3. esbuild.js

```javascript
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'info',
    plugins: [
      {
        name: 'watch-plugin',
        setup(build) {
          build.onEnd(result => {
            if (result.errors.length === 0) {
              console.log('[watch] build finished');
            }
          });
        },
      },
    ],
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
```

### 4. .gitignore

```
node_modules/
dist/
out/
*.vsix
.vscode-test/
webview-ui/node_modules/
webview-ui/dist/
.DS_Store
*.log
```

### 5. .vscode/launch.json

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}"
      ],
      "outFiles": [
        "${workspaceFolder}/dist/**/*.js"
      ],
      "preLaunchTask": "npm: watch"
    }
  ]
}
```

### 6. .vscode/tasks.json

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "watch",
      "problemMatcher": "$tsc-watch",
      "isBackground": true,
      "presentation": {
        "reveal": "never"
      },
      "group": {
        "kind": "build",
        "isDefault": true
      }
    }
  ]
}
```

---

## Source Files

### src/extension.ts

```typescript
import * as vscode from 'vscode';
import { DSAgentClient } from './api/client';
import { ChatViewProvider } from './providers/chatViewProvider';
import { SessionsTreeProvider } from './providers/sessionsTreeProvider';
import { VariablesTreeProvider } from './providers/variablesTreeProvider';
import { StatusBarManager } from './services/statusBar';
import { registerCommands } from './commands';

let client: DSAgentClient;
let statusBar: StatusBarManager;

export async function activate(context: vscode.ExtensionContext) {
    console.log('DSAgent extension is now active');

    // Get configuration
    const config = vscode.workspace.getConfiguration('dsagent');
    const serverUrl = config.get<string>('serverUrl', 'http://localhost:8000');

    // Initialize API client
    client = new DSAgentClient(serverUrl);

    // Status bar
    statusBar = new StatusBarManager(client);
    context.subscriptions.push(statusBar);

    // Chat panel (sidebar webview)
    const chatProvider = new ChatViewProvider(context.extensionUri, client);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType,
            chatProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // Sessions tree view
    const sessionsProvider = new SessionsTreeProvider(client);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('dsagent.sessionsView', sessionsProvider)
    );

    // Variables tree view
    const variablesProvider = new VariablesTreeProvider(client);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('dsagent.variablesView', variablesProvider)
    );

    // Register all commands
    registerCommands(context, client, chatProvider, sessionsProvider, variablesProvider);

    // Auto-connect if enabled
    if (config.get<boolean>('autoConnect', true)) {
        try {
            await client.connect();
            vscode.window.showInformationMessage('DSAgent: Connected to server');
        } catch (error) {
            vscode.window.showWarningMessage(
                'DSAgent: Could not connect to server. Make sure "dsagent serve" is running.'
            );
        }
    }
}

export function deactivate() {
    if (client) {
        client.disconnect();
    }
}
```

### src/api/types.ts

```typescript
export interface Session {
    id: string;
    created_at: string;
    updated_at: string;
    status: 'active' | 'completed' | 'error';
    task?: string;
    model?: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    metadata?: {
        code?: string;
        has_plan?: boolean;
        has_answer?: boolean;
    };
}

export interface PlanStep {
    number: number;
    description: string;
    completed: boolean;
}

export interface PlanState {
    steps: PlanStep[];
    raw_text: string;
    progress: string;
    total_steps: number;
}

export interface ExecutionResult {
    success: boolean;
    output: string;
    error?: string;
    images?: Array<{
        mime: string;
        data: string;
    }>;
}

export interface AgentEvent {
    type: 'thinking' | 'plan' | 'code_executing' | 'code_result' | 'answer' | 'error' | 'complete' | 'hitl_request' | 'connected';
    content?: string;
    code?: string;
    plan?: PlanState;
    result?: ExecutionResult;
    message?: string;
    session_id?: string;
}

export interface KernelState {
    variables: Record<string, {
        type: string;
        value?: string;
        shape?: string;
    }>;
    dataframes: Record<string, {
        shape: [number, number];
        columns: string[];
        dtypes: Record<string, string>;
    }>;
    imports: string[];
}

export interface HITLRequest {
    type: 'plan' | 'code' | 'answer';
    plan?: PlanState;
    code?: string;
    message?: string;
}
```

### src/api/client.ts

```typescript
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type {
    Session,
    AgentEvent,
    ExecutionResult,
    KernelState
} from './types';

export class DSAgentClient extends EventEmitter {
    private baseUrl: string;
    private wsUrl: string;
    private ws: WebSocket | null = null;
    private currentSession: Session | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectTimeout: NodeJS.Timeout | null = null;

    constructor(baseUrl: string = 'http://localhost:8000') {
        super();
        this.baseUrl = baseUrl;
        this.wsUrl = baseUrl.replace(/^http/, 'ws');
    }

    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
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
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.currentSession = null;
        this.emit('disconnected');
    }

    // === Session Management ===

    async createSession(): Promise<Session> {
        const response = await this.fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        if (!response.ok) {
            throw new Error(`Failed to create session: ${response.statusText}`);
        }

        const session: Session = await response.json();
        this.currentSession = session;

        await this.connectWebSocket(session.id);

        this.emit('sessionCreated', session);
        return session;
    }

    async listSessions(): Promise<Session[]> {
        const response = await this.fetch('/api/sessions');
        if (!response.ok) {
            throw new Error('Failed to list sessions');
        }
        return response.json();
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

        await this.connectWebSocket(sessionId);

        this.emit('sessionResumed', session);
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

    // === WebSocket ===

    private async connectWebSocket(sessionId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = `${this.wsUrl}/ws/chat/${sessionId}`;
            this.ws = new WebSocket(url);

            const timeout = setTimeout(() => {
                reject(new Error('WebSocket connection timeout'));
            }, 10000);

            this.ws.onopen = () => {
                clearTimeout(timeout);
                this.reconnectAttempts = 0;
                this.emit('connected', sessionId);
                resolve();
            };

            this.ws.onmessage = (event) => {
                try {
                    const data: AgentEvent = JSON.parse(event.data.toString());
                    this.handleEvent(data);
                } catch (e) {
                    console.error('Failed to parse WebSocket message:', e);
                }
            };

            this.ws.onerror = (error) => {
                clearTimeout(timeout);
                this.emit('error', error);
                reject(error);
            };

            this.ws.onclose = () => {
                this.emit('disconnected');
                this.attemptReconnect(sessionId);
            };
        });
    }

    private attemptReconnect(sessionId: string): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.emit('reconnectFailed');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

        this.emit('reconnecting', this.reconnectAttempts);

        this.reconnectTimeout = setTimeout(() => {
            this.connectWebSocket(sessionId).catch(() => {
                // Will trigger another reconnect attempt
            });
        }, delay);
    }

    private handleEvent(event: AgentEvent): void {
        // Emit specific event
        this.emit(event.type, event);

        // Also emit generic event for logging/debugging
        this.emit('event', event);
    }

    // === Chat ===

    sendMessage(content: string): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected to server');
        }

        this.ws.send(JSON.stringify({
            type: 'CHAT',
            content,
        }));

        this.emit('messageSent', content);
    }

    approveAction(action: 'approve' | 'reject' | 'modify', modification?: string): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        this.ws.send(JSON.stringify({
            type: 'APPROVE',
            action,
            modification,
        }));
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
            throw new Error('Code execution failed');
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

    // === Helper ===

    private async fetch(path: string, options?: RequestInit): Promise<Response> {
        const url = `${this.baseUrl}${path}`;
        return fetch(url, {
            ...options,
            headers: {
                ...options?.headers,
            },
        });
    }
}
```

---

## Commands to Run After Creating Files

```bash
# 1. Install extension dependencies
npm install

# 2. Create webview-ui (React app for chat)
cd webview-ui
npm init -y
npm install react react-dom
npm install -D @types/react @types/react-dom @vitejs/plugin-react typescript vite

# 3. Build extension
cd ..
npm run build

# 4. Test in VS Code
# Press F5 to launch Extension Development Host
```

---

## DSAgent Server Requirement

The extension requires `dsagent serve` running:

```bash
# In terminal 1 (dsagent directory)
cd /Users/nmlemus/projects/aiudalabs.com/mvps/dsagent
dsagent serve --port 8000

# In terminal 2 (VS Code extension dev)
cd /Users/nmlemus/projects/aiudalabs.com/mvps/dsagent-vscode
code .
# Press F5 to debug
```

---

## Next Steps for Claude

When you open Claude in this directory, ask:

1. "Create all the source files from SETUP.md"
2. "Create the webview-ui React app for the chat interface"
3. "Add the SVG icon for the extension"

The plan is:
- **Phase 1**: Basic chat panel + connection to dsagent server
- **Phase 2**: Notebook integration
- **Phase 3**: Session management + HITL
- **Phase 4**: Polish + Marketplace publish
