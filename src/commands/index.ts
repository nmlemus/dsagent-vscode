import * as vscode from 'vscode';
import { DSAgentClient } from '../api/client';
import { ChatPanelProvider } from '../providers/chatViewProvider';
import { SessionsTreeProvider } from '../providers/sessionsTreeProvider';
import { VariablesTreeProvider } from '../providers/variablesTreeProvider';

export function registerCommands(
    context: vscode.ExtensionContext,
    client: DSAgentClient,
    chatProvider: ChatPanelProvider,
    sessionsProvider: SessionsTreeProvider,
    variablesProvider: VariablesTreeProvider
): void {
    // Connect to server
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.connectServer', async () => {
            const config = vscode.workspace.getConfiguration('dsagent');
            const serverUrl = config.get<string>('serverUrl', 'http://localhost:8000');

            try {
                const connected = await client.connect();
                if (connected) {
                    vscode.window.showInformationMessage('DSAgent: Connected to server');
                    sessionsProvider.refresh();
                } else {
                    vscode.window.showErrorMessage(
                        `DSAgent: Could not connect to ${serverUrl}. Make sure "dsagent serve" is running.`
                    );
                }
            } catch (error) {
                vscode.window.showErrorMessage(
                    `DSAgent: Connection failed - ${error instanceof Error ? error.message : 'Unknown error'}`
                );
            }
        })
    );

    // Disconnect from server
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.disconnectServer', () => {
            client.disconnect();
            vscode.window.showInformationMessage('DSAgent: Disconnected from server');
        })
    );

    // Analyze selection — opens native chat with @dsagent and the selected text
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.analyzeSelection', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }

            const selection = editor.selection;
            const text = editor.document.getText(selection);

            if (!text) {
                vscode.window.showWarningMessage('No text selected');
                return;
            }

            // Open VS Code chat with @dsagent and the prompt
            vscode.commands.executeCommand('workbench.action.chat.open', {
                query: `@dsagent /analyze ${text}`,
            });
        })
    );

    // Analyze file — opens native chat with @dsagent
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.analyzeFile', async (uri?: vscode.Uri) => {
            let fileUri = uri;

            if (!fileUri) {
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor) {
                    fileUri = activeEditor.document.uri;
                } else {
                    const files = await vscode.window.showOpenDialog({
                        canSelectMany: false,
                        filters: {
                            'Data Files': ['csv', 'xlsx', 'json', 'parquet'],
                        },
                    });
                    if (files && files.length > 0) {
                        fileUri = files[0];
                    }
                }
            }

            if (!fileUri) {
                vscode.window.showWarningMessage('No file selected');
                return;
            }

            const fileName = fileUri.fsPath.split('/').pop() || fileUri.fsPath;

            // Open VS Code chat with @dsagent and file reference
            vscode.commands.executeCommand('workbench.action.chat.open', {
                query: `@dsagent /analyze Analyze the file: ${fileName} (path: ${fileUri.fsPath})`,
            });
        })
    );

    // Refresh sessions
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.refreshSessions', () => {
            sessionsProvider.refresh();
        })
    );

    // Resume session — opens the chat panel with session history
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.resumeSession', async (sessionId: string) => {
            try {
                await chatProvider.loadSession(sessionId);
                sessionsProvider.refresh();
                variablesProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage('Failed to resume session');
            }
        })
    );

    // Delete session
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.deleteSession', async (item: { sessionId: string }) => {
            if (item && item.sessionId) {
                await sessionsProvider.deleteSession(item.sessionId);
            }
        })
    );

    // Refresh variables
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.refreshVariables', () => {
            variablesProvider.refresh();
        })
    );
}
