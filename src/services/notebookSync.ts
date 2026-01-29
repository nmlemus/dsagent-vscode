import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { DSAgentClient } from '../api/client';
import type { AgentEvent, ExecutionResult } from '../api/types';

/**
 * Manages the session notebook — downloads from the backend and syncs
 * agent code execution events to it.
 */
export class NotebookSyncService {
    private notebook?: vscode.NotebookDocument;
    private notebookUri?: vscode.Uri;
    private pendingCellIndex: number = -1;
    private sessionId: string | null = null;

    constructor(private readonly client: DSAgentClient) {
        this.setupListeners();
    }

    private setupListeners(): void {
        this.client.on('connected', (sessionId: string) => {
            this.sessionId = sessionId;
            // Reset notebook when session changes
            this.reset();
        });

        this.client.on('disconnected', () => {
            this.sessionId = null;
        });

        this.client.on('code_executing', (event: AgentEvent) => {
            if (event.code) {
                this.appendCodeCell(event.code);
            }
        });

        this.client.on('code_result', (event: AgentEvent) => {
            if (event.result) {
                this.fillCellOutput(event.result);
            }
        });
    }

    /**
     * Get the URI of the session notebook (if open).
     */
    get notebookPath(): vscode.Uri | undefined {
        return this.notebookUri;
    }

    /**
     * Download and open the session notebook from the backend.
     */
    async openSessionNotebook(): Promise<vscode.NotebookDocument | undefined> {
        if (!this.sessionId) {
            vscode.window.showWarningMessage('No active session');
            return undefined;
        }

        // If already open, just reveal
        if (this.notebook && !this.notebook.isClosed) {
            await vscode.window.showNotebookDocument(this.notebook, {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true,
            });
            return this.notebook;
        }

        try {
            // Download the notebook from the backend
            const notebookData = await this.client.downloadNotebook();

            // Save to a temp file
            const tempDir = os.tmpdir();
            const fileName = `${this.sessionId}.ipynb`;
            const filePath = path.join(tempDir, 'dsagent-notebooks', fileName);
            this.notebookUri = vscode.Uri.file(filePath);

            // Ensure directory exists and write file
            await vscode.workspace.fs.createDirectory(
                vscode.Uri.file(path.join(tempDir, 'dsagent-notebooks'))
            );
            await vscode.workspace.fs.writeFile(this.notebookUri, notebookData);

            // Open the notebook
            const doc = await vscode.workspace.openNotebookDocument(this.notebookUri);

            await vscode.window.showNotebookDocument(doc, {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true,
            });

            this.notebook = doc;
            return doc;
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to open session notebook: ${msg}`);
            return undefined;
        }
    }

    /**
     * Refresh the notebook from the backend (re-download).
     */
    async refreshNotebook(): Promise<void> {
        if (!this.sessionId) {
            return;
        }

        try {
            const notebookData = await this.client.downloadNotebook();

            if (this.notebookUri) {
                await vscode.workspace.fs.writeFile(this.notebookUri, notebookData);

                // Reopen to refresh content
                if (this.notebook && !this.notebook.isClosed) {
                    // Close and reopen
                    const uri = this.notebookUri;
                    // Find and close the tab
                    for (const group of vscode.window.tabGroups.all) {
                        for (const tab of group.tabs) {
                            if (tab.input instanceof vscode.TabInputNotebook) {
                                if (tab.input.uri.toString() === uri.toString()) {
                                    await vscode.window.tabGroups.close(tab);
                                }
                            }
                        }
                    }
                    // Reopen
                    await this.openSessionNotebook();
                }
            }
        } catch (error) {
            console.error('Failed to refresh notebook:', error);
        }
    }

    private async appendCodeCell(code: string): Promise<void> {
        // Only sync if we have the session notebook open
        if (!this.notebook || this.notebook.isClosed) {
            // Try to open it
            await this.openSessionNotebook();
        }

        const doc = this.notebook;
        if (!doc) {
            return;
        }

        const cellData = new vscode.NotebookCellData(
            vscode.NotebookCellKind.Code,
            code,
            'python'
        );

        const edit = new vscode.WorkspaceEdit();
        const insertIndex = doc.cellCount;
        const nbEdit = vscode.NotebookEdit.insertCells(insertIndex, [cellData]);
        edit.set(doc.uri, [nbEdit]);
        await vscode.workspace.applyEdit(edit);

        this.pendingCellIndex = insertIndex;

        // Scroll to the new cell
        const editor = vscode.window.visibleNotebookEditors.find(
            e => e.notebook.uri.toString() === doc.uri.toString()
        );
        if (editor) {
            const range = new vscode.NotebookRange(insertIndex, insertIndex + 1);
            editor.revealRange(range, vscode.NotebookEditorRevealType.Default);
        }
    }

    private async fillCellOutput(result: ExecutionResult): Promise<void> {
        if (!this.notebook || this.notebook.isClosed || this.pendingCellIndex < 0) {
            return;
        }

        const cell = this.notebook.cellAt(this.pendingCellIndex);
        if (!cell) {
            return;
        }

        const outputs: vscode.NotebookCellOutput[] = [];

        if (result.output) {
            outputs.push(
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text(result.output),
                ])
            );
        }

        if (result.error) {
            outputs.push(
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error({
                        name: 'ExecutionError',
                        message: result.error,
                    }),
                ])
            );
        }

        if (result.images && result.images.length > 0) {
            for (const image of result.images) {
                const mime = image.mime || 'image/png';
                outputs.push(
                    new vscode.NotebookCellOutput([
                        new vscode.NotebookCellOutputItem(
                            Buffer.from(image.data, 'base64'),
                            mime
                        ),
                    ])
                );
            }
        }

        if (outputs.length > 0) {
            const edit = new vscode.WorkspaceEdit();
            const nbEdit = vscode.NotebookEdit.updateCellOutputs(
                this.pendingCellIndex,
                outputs
            );
            edit.set(this.notebook.uri, [nbEdit]);
            await vscode.workspace.applyEdit(edit);
        }

        this.pendingCellIndex = -1;
    }

    /**
     * Check if a notebook document is the session notebook.
     */
    isSessionNotebook(doc: vscode.NotebookDocument): boolean {
        if (!this.notebookUri) {
            return false;
        }
        return doc.uri.toString() === this.notebookUri.toString();
    }

    reset(): void {
        this.notebook = undefined;
        this.notebookUri = undefined;
        this.pendingCellIndex = -1;
    }

    dispose(): void {
        this.reset();
    }
}
