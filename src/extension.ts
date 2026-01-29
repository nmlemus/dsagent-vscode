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

    // Chat panel (opens as editor panel on the right)
    const chatProvider = new ChatViewProvider(context.extensionUri, client);
    context.subscriptions.push({ dispose: () => chatProvider.dispose() });

    // Command to open/focus the chat panel
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.openChat', () => {
            chatProvider.show();
        })
    );

    // Sessions tree view (left sidebar)
    const sessionsProvider = new SessionsTreeProvider(client);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('dsagent.sessionsView', sessionsProvider)
    );

    // Variables tree view (left sidebar)
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
