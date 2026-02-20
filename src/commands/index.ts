import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DSAgentClient } from '../api/client';
import { ChatPanelProvider } from '../providers/chatViewProvider';
import { SessionsTreeProvider } from '../providers/sessionsTreeProvider';
import { VariablesTreeProvider } from '../providers/variablesTreeProvider';
import { ArtifactsTreeProvider } from '../providers/artifactsTreeProvider';

export function registerCommands(
    context: vscode.ExtensionContext,
    client: DSAgentClient,
    chatProvider: ChatPanelProvider,
    sessionsProvider: SessionsTreeProvider,
    variablesProvider: VariablesTreeProvider,
    artifactsProvider: ArtifactsTreeProvider
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

    // Archive session
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.archiveSession', async (item: { sessionId: string }) => {
            const sessionId = item?.sessionId;
            if (!sessionId) {
                return;
            }
            try {
                await client.archiveSession(sessionId);
                sessionsProvider.refresh();
                vscode.window.showInformationMessage('Session archived');
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to archive session: ${msg}`);
            }
        })
    );

    // Export session as JSON
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.exportSessionAsJson', async (item: { sessionId: string }) => {
            const sessionId = item?.sessionId;
            if (!sessionId) {
                return;
            }
            try {
                const data = await client.exportSessionJson(sessionId);
                const defaultName = `session-${sessionId}.json`;
                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(
                        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir(),
                        defaultName
                    )),
                    filters: { JSON: ['json'] },
                });
                if (!saveUri) {
                    return;
                }
                fs.writeFileSync(saveUri.fsPath, data);
                vscode.window.showInformationMessage(`Session exported to ${saveUri.fsPath}`);
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to export session: ${msg}`);
            }
        })
    );

    // Set session model (current session)
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.setSessionModel', async () => {
            const models = [
                'gpt-5.1', 'gpt-5.2', 'gpt-5.2-codex', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514',
                'gemini-3-pro-preview', 'gemini-3-flash-preview', 'groq/openai/gpt-oss-120b', 'groq/qwen/qwen3-32b',
                'groq/moonshotai/kimi-k2-instruct-0905', 'openrouter/qwen/qwen3-coder-next', 'openrouter/minimax/minimax-m2.1',
            ];
            const current = client.session?.model;
            const picked = await vscode.window.showQuickPick(models.map(m => ({
                label: m,
                description: m === current ? '(current)' : undefined,
            })), { title: 'DSAgent: Set session model', placeHolder: 'Choose model' });
            if (!picked || !client.session) {
                return;
            }
            try {
                await client.updateSession({ model: picked.label });
                vscode.window.showInformationMessage(`Session model set to: ${picked.label}`);
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to set model: ${msg}`);
            }
        })
    );

    // Set session status (current session)
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.setSessionStatus', async () => {
            interface StatusOption extends vscode.QuickPickItem { status: string }
            const statuses: StatusOption[] = [
                { label: 'Active', status: 'active', description: undefined },
                { label: 'Paused', status: 'paused', description: undefined },
                { label: 'Completed', status: 'completed', description: undefined },
            ];
            const current = client.session?.status;
            statuses.forEach(s => { s.description = s.status === current ? '(current)' : undefined; });
            const picked = await vscode.window.showQuickPick(statuses, {
                title: 'DSAgent: Set session status',
                placeHolder: 'Choose status',
            });
            if (!picked || !client.session) {
                return;
            }
            try {
                await client.updateSession({ status: picked.status });
                vscode.window.showInformationMessage(`Session status set to: ${picked.label}`);
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to set status: ${msg}`);
            }
        })
    );

    // Delete artifact
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.deleteArtifact', async (item: { artifact?: { name: string } }) => {
            const artifact = item?.artifact;
            if (!artifact?.name) {
                return;
            }
            const sessionId = client.session?.id;
            if (!sessionId) {
                vscode.window.showWarningMessage('No active session');
                return;
            }
            const confirm = await vscode.window.showWarningMessage(
                `Delete artifact "${artifact.name}"?`,
                { modal: true },
                'Delete'
            );
            if (confirm !== 'Delete') {
                return;
            }
            try {
                await client.deleteArtifact(sessionId, artifact.name);
                artifactsProvider.refresh();
                vscode.window.showInformationMessage('Artifact deleted');
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to delete artifact: ${msg}`);
            }
        })
    );

    // Reset kernel (current session)
    context.subscriptions.push(
        vscode.commands.registerCommand('dsagent.resetKernel', async () => {
            if (!client.session) {
                vscode.window.showWarningMessage('No active session');
                return;
            }
            try {
                await client.resetKernel();
                variablesProvider.refresh();
                vscode.window.showInformationMessage('Kernel reset successfully');
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to reset kernel: ${msg}`);
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
