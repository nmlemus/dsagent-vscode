import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { DSAgentClient } from './api/client';
import type { HITLMode } from './api/types';
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
            const hitlMode = vscode.workspace.getConfiguration('dsagent')
                .get<HITLMode>('hitlMode', 'none');
            chatPanel.startNewChat(name || undefined, hitlMode);
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

    // Set HITL mode command — quick pick to change mode for the active session
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.setHitlMode', async () => {
            const modes: Array<{ label: string; description: string; mode: HITLMode }> = [
                { label: '$(circle-slash) None', description: 'Agent runs autonomously', mode: 'none' },
                { label: '$(checklist) Plan Only', description: 'Approve before executing a plan', mode: 'plan_only' },
                { label: '$(shield) Full', description: 'Approve every plan and code execution', mode: 'full' },
                { label: '$(comment-discussion) Plan + Answer', description: 'Approve plans and final answers', mode: 'plan_and_answer' },
                { label: '$(warning) On Error', description: 'Approve only when errors occur', mode: 'on_error' },
            ];

            const currentMode = client.session?.hitl_mode || 'none';
            const items = modes.map(m => ({
                ...m,
                picked: m.mode === currentMode,
                description: m.mode === currentMode ? `${m.description} (current)` : m.description,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                title: 'Set Human-in-the-Loop Mode',
                placeHolder: 'Choose when the agent should pause for approval',
            });

            if (!selected) {
                return;
            }

            if (client.session) {
                try {
                    await client.updateSession({ hitl_mode: selected.mode });
                    vscode.window.showInformationMessage(`HITL mode set to: ${selected.label.replace(/\$\([^)]+\)\s*/, '')}`);
                } catch (error) {
                    const msg = error instanceof Error ? error.message : 'Unknown error';
                    vscode.window.showErrorMessage(`Failed to update HITL mode: ${msg}`);
                }
            } else {
                // No active session — update the setting for future sessions
                await vscode.workspace.getConfiguration('dsagent')
                    .update('hitlMode', selected.mode, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(
                    `HITL mode for new sessions set to: ${selected.label.replace(/\$\([^)]+\)\s*/, '')}`
                );
            }
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

    // Variables commands
    let dataFramePreviewPanel: vscode.WebviewPanel | undefined;

    context.subscriptions.push(
        // Preview DataFrame — execute df.head(20).to_html() and show in webview
        vscode.commands.registerCommand('dsagent.previewDataFrame', async (name: string) => {
            if (!client.session) {
                vscode.window.showWarningMessage('No active session');
                return;
            }
            try {
                const result = await client.executeCode(
                    `${name}.head(20).to_html(classes='dataframe', border=0)`
                );
                const html = (result as any).stdout || result.output || '';
                if (!html) {
                    vscode.window.showWarningMessage('No data returned');
                    return;
                }
                if (dataFramePreviewPanel) {
                    dataFramePreviewPanel.title = `Preview: ${name}`;
                    dataFramePreviewPanel.webview.html = getDataFramePreviewHtml(name, html);
                    dataFramePreviewPanel.reveal(vscode.ViewColumn.Beside);
                } else {
                    dataFramePreviewPanel = vscode.window.createWebviewPanel(
                        'dsagent.dataFramePreview',
                        `Preview: ${name}`,
                        vscode.ViewColumn.Beside,
                        { enableScripts: false }
                    );
                    dataFramePreviewPanel.webview.html = getDataFramePreviewHtml(name, html);
                    dataFramePreviewPanel.onDidDispose(() => {
                        dataFramePreviewPanel = undefined;
                    });
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to preview DataFrame: ${msg}`);
            }
        }),

        // Inspect variable — execute repr(var) and show in output channel
        vscode.commands.registerCommand('dsagent.inspectVariable', async (name: string) => {
            if (!client.session) {
                vscode.window.showWarningMessage('No active session');
                return;
            }
            try {
                const result = await client.executeCode(`print(repr(${name}))`);
                const output = (result as any).stdout || result.output || '';
                const channel = vscode.window.createOutputChannel(`DSAgent: ${name}`, 'python');
                channel.replace(output);
                channel.show(true);
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to inspect variable: ${msg}`);
            }
        }),

        // Copy variable name to clipboard
        vscode.commands.registerCommand('dsagent.copyVariableName', async (item: { label: string }) => {
            const name = typeof item === 'string' ? item : item?.label;
            if (name) {
                await vscode.env.clipboard.writeText(name);
                vscode.window.showInformationMessage(`Copied "${name}" to clipboard`);
            }
        }),

        // Describe DataFrame — execute df.describe() and show in output channel
        vscode.commands.registerCommand('dsagent.describeDataFrame', async (item: { label: string }) => {
            const name = typeof item === 'string' ? item : item?.label;
            if (!name || !client.session) {
                return;
            }
            try {
                const result = await client.executeCode(`print(${name}.describe().to_string())`);
                const output = (result as any).stdout || result.output || '';
                const channel = vscode.window.createOutputChannel(`DSAgent: ${name}.describe()`, 'python');
                channel.replace(output);
                channel.show(true);
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to describe DataFrame: ${msg}`);
            }
        }),

        // DataFrame info — execute df.info() and show in output channel
        vscode.commands.registerCommand('dsagent.dataFrameInfo', async (item: { label: string }) => {
            const name = typeof item === 'string' ? item : item?.label;
            if (!name || !client.session) {
                return;
            }
            try {
                const result = await client.executeCode(
                    `import io as _io; _buf = _io.StringIO(); ${name}.info(buf=_buf); print(_buf.getvalue())`
                );
                const output = (result as any).stdout || result.output || '';
                const channel = vscode.window.createOutputChannel(`DSAgent: ${name}.info()`, 'python');
                channel.replace(output);
                channel.show(true);
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to get DataFrame info: ${msg}`);
            }
        }),

        // Quick plot — execute a histogram and show result image
        vscode.commands.registerCommand('dsagent.plotVariable', async (item: { label: string }) => {
            const name = typeof item === 'string' ? item : item?.label;
            if (!name || !client.session) {
                return;
            }
            try {
                const result = await client.executeCode(
                    `import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\n${name}.hist(figsize=(10,6))\nplt.title('${name} — Distribution')\nplt.tight_layout()\nplt.savefig('/tmp/_dsagent_quickplot.png', dpi=100)\nplt.close()\nprint('ok')`
                );
                const output = (result as any).stdout || result.output || '';
                if (output.includes('ok')) {
                    // Fetch the image via artifacts or temp file
                    const cfg = vscode.workspace.getConfiguration('dsagent');
                    const serverUrl = cfg.get<string>('serverUrl', 'http://localhost:8000');
                    const imgResult = await client.executeCode(
                        `import base64\nwith open('/tmp/_dsagent_quickplot.png','rb') as f: print(base64.b64encode(f.read()).decode())`
                    );
                    const b64 = ((imgResult as any).stdout || imgResult.output || '').trim();
                    if (b64) {
                        if (dataFramePreviewPanel) {
                            dataFramePreviewPanel.title = `Plot: ${name}`;
                            dataFramePreviewPanel.webview.html = getPlotPreviewHtml(name, b64);
                            dataFramePreviewPanel.reveal(vscode.ViewColumn.Beside);
                        } else {
                            dataFramePreviewPanel = vscode.window.createWebviewPanel(
                                'dsagent.dataFramePreview',
                                `Plot: ${name}`,
                                vscode.ViewColumn.Beside,
                                { enableScripts: false }
                            );
                            dataFramePreviewPanel.webview.html = getPlotPreviewHtml(name, b64);
                            dataFramePreviewPanel.onDidDispose(() => {
                                dataFramePreviewPanel = undefined;
                            });
                        }
                    }
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to plot: ${msg}`);
            }
        }),

        // Analyze with DSAgent — send to chat
        vscode.commands.registerCommand('dsagent.analyzeVariable', async (item: { label: string; itemType?: string }) => {
            const name = typeof item === 'string' ? item : item?.label;
            if (!name) {
                return;
            }
            const type = item?.itemType === 'dataframe' ? 'dataframe' : 'variable';
            chatPanel.show();
            chatPanel.sendAnalysisRequest(name, type);
        })
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

function getDataFramePreviewHtml(name: string, tableHtml: string): string {
    return `<!DOCTYPE html>
<html><head><style>
body { margin: 0; padding: 16px; background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-editor-foreground, #ccc); font-family: var(--vscode-font-family, monospace); font-size: 13px; }
h2 { margin: 0 0 12px 0; font-size: 15px; font-weight: 500; }
table.dataframe { border-collapse: collapse; width: 100%; }
table.dataframe th, table.dataframe td { padding: 6px 10px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); white-space: nowrap; }
table.dataframe th { background: rgba(255,255,255,0.05); font-weight: 600; position: sticky; top: 0; }
table.dataframe tr:hover td { background: rgba(255,255,255,0.04); }
.note { margin-top: 12px; font-size: 11px; opacity: 0.6; }
</style></head>
<body>
<h2>${name}</h2>
${tableHtml}
<p class="note">Showing first 20 rows</p>
</body></html>`;
}

function getPlotPreviewHtml(name: string, base64: string): string {
    return `<!DOCTYPE html>
<html><head><style>
body { margin: 0; display: flex; flex-direction: column; align-items: center; padding: 16px; background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-editor-foreground, #ccc); }
h2 { margin: 0 0 12px 0; font-size: 15px; font-weight: 500; }
img { max-width: 100%; height: auto; }
</style></head>
<body>
<h2>${name}</h2>
<img src="data:image/png;base64,${base64}" alt="${name}">
</body></html>`;
}
