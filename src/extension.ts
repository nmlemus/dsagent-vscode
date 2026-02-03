import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { DSAgentClient } from './api/client';
import { ChatPanelProvider } from './providers/chatViewProvider';
import { DSAgentChatParticipant } from './providers/chatParticipant';
import { DSAgentNotebookController } from './providers/notebookController';
import { SessionsTreeProvider } from './providers/sessionsTreeProvider';
import { VariablesTreeProvider } from './providers/variablesTreeProvider';
import { ArtifactsTreeProvider } from './providers/artifactsTreeProvider';
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
    const apiKey = config.get<string>('apiKey', '');

    // Initialize API client
    client = new DSAgentClient(serverUrl);
    if (apiKey) {
        client.setApiKey(apiKey);
    }

    // React to settings changes at runtime
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('dsagent.serverUrl') || e.affectsConfiguration('dsagent.apiKey')) {
                const updated = vscode.workspace.getConfiguration('dsagent');
                const newUrl = updated.get<string>('serverUrl', 'http://localhost:8000');
                const newKey = updated.get<string>('apiKey', '');

                client.disconnect();
                client.setBaseUrl(newUrl);
                client.setApiKey(newKey || null);

                // Auto-reconnect with new settings
                client.connect().then(connected => {
                    if (connected) {
                        vscode.window.showInformationMessage(`DSAgent: Connected to ${newUrl}`);
                    } else {
                        vscode.window.showWarningMessage(`DSAgent: Could not connect to ${newUrl}`);
                    }
                });
            }
        })
    );

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
        vscode.commands.registerCommand('dsagent.startChat', async () => {
            const name = await vscode.window.showInputBox({
                title: 'New DSAgent Session',
                prompt: 'Enter a name for the session',
                placeHolder: 'e.g. iris analysis, sales report...',
            });
            if (name === undefined) {
                return; // Cancelled
            }
            chatPanel.startNewChat(name || undefined);
        })
    );

    // Configure server command — quick input for URL + API key
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.configureServer', async () => {
            const cfg = vscode.workspace.getConfiguration('dsagent');

            const url = await vscode.window.showInputBox({
                title: 'DSAgent Server URL',
                prompt: 'Enter the server URL (e.g. http://localhost:8000 or https://remote-host:8000)',
                value: cfg.get<string>('serverUrl', 'http://localhost:8000'),
                validateInput: (value) => {
                    try {
                        new URL(value);
                        return null;
                    } catch {
                        return 'Please enter a valid URL';
                    }
                },
            });

            if (url === undefined) {
                return; // Cancelled
            }

            const key = await vscode.window.showInputBox({
                title: 'DSAgent API Key',
                prompt: 'Enter the API key (leave empty if not required)',
                value: cfg.get<string>('apiKey', ''),
                password: true,
            });

            if (key === undefined) {
                return; // Cancelled
            }

            await cfg.update('serverUrl', url, vscode.ConfigurationTarget.Global);
            await cfg.update('apiKey', key, vscode.ConfigurationTarget.Global);
            // The onDidChangeConfiguration listener handles reconnection
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

    // Export notebook — download .ipynb and open or save
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.exportNotebook', async () => {
            if (!client.session) {
                vscode.window.showWarningMessage('No active session. Start a chat first.');
                return;
            }

            try {
                const data = await client.downloadNotebook();
                const sessionName = client.session.name || client.session.id;
                const defaultName = `${sessionName}.ipynb`;

                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(
                        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir(),
                        defaultName
                    )),
                    filters: { 'Jupyter Notebook': ['ipynb'] },
                });

                if (!saveUri) {
                    return; // Cancelled
                }

                fs.writeFileSync(saveUri.fsPath, data);
                const openChoice = await vscode.window.showInformationMessage(
                    `Notebook exported to ${saveUri.fsPath}`,
                    'Open Notebook'
                );
                if (openChoice === 'Open Notebook') {
                    await vscode.commands.executeCommand('vscode.openWith', saveUri, 'jupyter-notebook');
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to export notebook: ${msg}`);
            }
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

    // Artifacts tree view (left sidebar)
    const artifactsProvider = new ArtifactsTreeProvider(client);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('dsagent.artifactsView', artifactsProvider)
    );

    // Artifacts commands
    let artifactPreviewPanel: vscode.WebviewPanel | undefined;

    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.refreshArtifacts', () => {
            artifactsProvider.refresh();
        }),
        vscode.commands.registerCommand('dsagent.openArtifact', async (artifact: { name: string; url: string; type: string }) => {
            if (!artifact?.url) {
                return;
            }

            const config = vscode.workspace.getConfiguration('dsagent');
            const serverUrl = config.get<string>('serverUrl', 'http://localhost:8000');
            const fullUrl = `${serverUrl}${artifact.url}`;

            if (artifact.type === 'image') {
                if (artifactPreviewPanel) {
                    // Reuse the existing panel — just update title and content
                    artifactPreviewPanel.title = artifact.name;
                    artifactPreviewPanel.webview.html = getArtifactPreviewHtml(fullUrl, artifact.name);
                    artifactPreviewPanel.reveal(vscode.ViewColumn.Beside);
                } else {
                    artifactPreviewPanel = vscode.window.createWebviewPanel(
                        'dsagent.artifactPreview',
                        artifact.name,
                        vscode.ViewColumn.Beside,
                        { enableScripts: false }
                    );
                    artifactPreviewPanel.webview.html = getArtifactPreviewHtml(fullUrl, artifact.name);
                    artifactPreviewPanel.onDidDispose(() => {
                        artifactPreviewPanel = undefined;
                    });
                }
            } else {
                // Download to temp file and open in VS Code
                try {
                    const response = await fetch(fullUrl);
                    if (!response.ok) {
                        vscode.window.showErrorMessage(`Failed to download artifact: ${response.statusText}`);
                        return;
                    }
                    const buffer = Buffer.from(await response.arrayBuffer());
                    const tmpDir = path.join(os.tmpdir(), 'dsagent-artifacts');
                    fs.mkdirSync(tmpDir, { recursive: true });
                    const tmpFile = path.join(tmpDir, artifact.name);
                    fs.writeFileSync(tmpFile, buffer);
                    const uri = vscode.Uri.file(tmpFile);
                    await vscode.commands.executeCommand('vscode.open', uri);
                } catch (error) {
                    const msg = error instanceof Error ? error.message : 'Unknown error';
                    vscode.window.showErrorMessage(`Failed to open artifact: ${msg}`);
                }
            }
        })
    );

    // Register all commands
    registerCommands(context, client, chatPanel, sessionsProvider, variablesProvider);

    // Auto-connect if enabled
    if (config.get<boolean>('autoConnect', true)) {
        try {
            const connected = await client.connect();
            if (connected) {
                vscode.window.showInformationMessage(`DSAgent: Connected to ${serverUrl}`);
            } else {
                vscode.window.showWarningMessage(
                    `DSAgent: Could not connect to ${serverUrl}. Make sure the server is running.`
                );
            }
        } catch (error) {
            vscode.window.showWarningMessage(
                `DSAgent: Could not connect to ${serverUrl}. Make sure the server is running.`
            );
        }
    }
}

export function deactivate() {
    if (client) {
        client.disconnect();
    }
}

function getArtifactPreviewHtml(url: string, name: string): string {
    return `<!DOCTYPE html>
<html><head><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1e1e1e;}img{max-width:100%;height:auto;}</style></head>
<body><img src="${url}" alt="${name}"></body></html>`;
}
