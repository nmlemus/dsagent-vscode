import * as vscode from 'vscode';
import { DSAgentClient } from './api/client';
import { ChatPanelProvider } from './providers/chatViewProvider';
import { DSAgentChatParticipant } from './providers/chatParticipant';
import { DSAgentNotebookController } from './providers/notebookController';
import { SessionsTreeProvider } from './providers/sessionsTreeProvider';
import { VariablesTreeProvider } from './providers/variablesTreeProvider';
import { StatusBarManager } from './services/statusBar';
import { NotebookSyncService } from './services/notebookSync';
import { registerCommands } from './commands';

let client: DSAgentClient;
let statusBar: StatusBarManager;
let chatParticipant: DSAgentChatParticipant;
let chatPanel: ChatPanelProvider;

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

    // Chat panel (custom WebviewPanel — opens beside the editor)
    chatPanel = new ChatPanelProvider(context.extensionUri, client);
    context.subscriptions.push({ dispose: () => chatPanel.dispose() });

    // Register chat panel commands
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.openChat', () => {
            chatPanel.show();
        }),
        vscode.commands.registerCommand('dsagent.startChat', () => {
            chatPanel.startNewChat();
        })
    );

    // Chat participant (native VS Code Chat API — appears in Secondary Side Bar)
    chatParticipant = new DSAgentChatParticipant(context, client);
    context.subscriptions.push({ dispose: () => chatParticipant.dispose() });

    // Notebook sync — downloads and syncs the session notebook
    const notebookSync = new NotebookSyncService(client);
    context.subscriptions.push({ dispose: () => notebookSync.dispose() });

    // Notebook controller — lets users run notebook cells via DSAgent kernel
    const notebookController = new DSAgentNotebookController(client);
    notebookController.setNotebookSync(notebookSync);
    context.subscriptions.push({ dispose: () => notebookController.dispose() });

    // Command to open the session notebook
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.openNotebook', () => {
            notebookSync.openSessionNotebook();
        })
    );

    // Command to refresh the session notebook from backend
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.refreshNotebook', () => {
            notebookSync.refreshNotebook();
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
    registerCommands(context, client, chatPanel, sessionsProvider, variablesProvider);

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
