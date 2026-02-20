import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { DSAgentClient } from '../api/client';
import type { SessionFile } from '../api/types';
import type { FileCategory } from '../api/types';

const CATEGORY_LABELS: Record<FileCategory, string> = {
    data: 'Data',
    artifacts: 'Artifacts',
    notebooks: 'Notebooks',
};

const CATEGORY_ICONS: Record<FileCategory, vscode.ThemeIcon> = {
    data: new vscode.ThemeIcon('database', new vscode.ThemeColor('charts.blue')),
    artifacts: new vscode.ThemeIcon('file-media', new vscode.ThemeColor('charts.purple')),
    notebooks: new vscode.ThemeIcon('notebook', new vscode.ThemeColor('charts.orange')),
};

const CATEGORY_ORDER: FileCategory[] = ['data', 'artifacts', 'notebooks'];

type FilesTreeItem = FileCategoryItem | SessionFileItem | PlaceholderItem;

export class FilesTreeProvider implements vscode.TreeDataProvider<FilesTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FilesTreeItem | undefined | null | void> =
        new vscode.EventEmitter<FilesTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FilesTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private filesByCategory: Partial<Record<FileCategory, SessionFile[]>> = {};

    constructor(private readonly client: DSAgentClient) {
        this.client.on('sessionCreated', () => this.refresh());
        this.client.on('sessionResumed', () => this.refresh());
    }

    refresh(): void {
        this.loadFiles().then(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    private async loadFiles(): Promise<void> {
        this.filesByCategory = {};
        const sessionId = this.client.session?.id;
        if (!sessionId) {
            return;
        }

        try {
            const [data, artifacts, notebooks] = await Promise.all([
                this.client.listFiles(sessionId, 'data'),
                this.client.listFiles(sessionId, 'artifacts'),
                this.client.listFiles(sessionId, 'notebooks'),
            ]);
            this.filesByCategory = { data, artifacts, notebooks };
        } catch {
            this.filesByCategory = {};
        }
    }

    getTreeItem(element: FilesTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: FilesTreeItem): Promise<FilesTreeItem[]> {
        if (element instanceof FileCategoryItem) {
            return element.children;
        }

        if (element instanceof SessionFileItem || element instanceof PlaceholderItem) {
            return [];
        }

        // Root
        if (!this.client.session) {
            return [new PlaceholderItem('No active session')];
        }

        await this.loadFiles();

        const items: FileCategoryItem[] = [];
        for (const cat of CATEGORY_ORDER) {
            const files = this.filesByCategory[cat] || [];
            if (files.length > 0) {
                items.push(new FileCategoryItem(cat, files));
            }
        }

        if (items.length === 0) {
            return [new PlaceholderItem('No files yet')];
        }

        if (items.length === 1 && items[0].children.length > 0) {
            return items[0].children;
        }

        return items;
    }

    /** Called by commands: download file (Save As). */
    async downloadFileItem(file: SessionFile, category: FileCategory): Promise<void> {
        const sessionId = this.client.session?.id;
        if (!sessionId) {
            vscode.window.showWarningMessage('No active session');
            return;
        }

        const defaultPath = path.join(
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir(),
            file.name
        );

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(defaultPath),
            saveLabel: 'Save',
        });

        if (!saveUri) {
            return;
        }

        try {
            const data = await this.client.downloadFile(sessionId, file.name, category);
            fs.writeFileSync(saveUri.fsPath, data);
            vscode.window.showInformationMessage(`Saved ${file.name} to ${saveUri.fsPath}`);
            this.refresh();
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to download file: ${msg}`);
        }
    }

    /** Called by commands: delete file with confirmation. */
    async deleteFileItem(file: SessionFile, category: FileCategory): Promise<void> {
        const sessionId = this.client.session?.id;
        if (!sessionId) {
            vscode.window.showWarningMessage('No active session');
            return;
        }

        const choice = await vscode.window.showWarningMessage(
            `Delete "${file.name}" from ${CATEGORY_LABELS[category]}?`,
            'Delete',
            'Cancel'
        );

        if (choice !== 'Delete') {
            return;
        }

        try {
            await this.client.deleteFile(sessionId, file.name, category);
            vscode.window.showInformationMessage(`Deleted ${file.name}`);
            this.refresh();
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to delete file: ${msg}`);
        }
    }
}

export class FileCategoryItem extends vscode.TreeItem {
    public readonly category: FileCategory;
    public readonly children: SessionFileItem[];

    constructor(category: FileCategory, files: SessionFile[]) {
        super(CATEGORY_LABELS[category], vscode.TreeItemCollapsibleState.Expanded);
        this.category = category;
        this.contextValue = 'fileCategory';
        this.iconPath = CATEGORY_ICONS[category];
        this.description = `${files.length}`;
        this.children = files.map(f => new SessionFileItem(f, category));
    }
}

export class SessionFileItem extends vscode.TreeItem {
    public readonly file: SessionFile;
    public readonly category: FileCategory;

    constructor(file: SessionFile, category: FileCategory);
    constructor(label: string, isPlaceholder: true);
    constructor(fileOrLabel: SessionFile | string, categoryOrPlaceholder?: FileCategory | true) {
        if (typeof fileOrLabel === 'string') {
            super(fileOrLabel, vscode.TreeItemCollapsibleState.None);
            return;
        }

        const file = fileOrLabel;
        const category = categoryOrPlaceholder as FileCategory;
        super(file.name, vscode.TreeItemCollapsibleState.None);
        this.file = file;
        this.category = category;
        this.contextValue = 'sessionFile';
        this.description = file.size !== undefined ? SessionFileItem.formatSize(file.size) : undefined;
        this.tooltip = SessionFileItem.buildTooltip(file);
        this.iconPath = new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.yellow'));
    }

    static formatSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    private static buildTooltip(file: SessionFile): string {
        const parts = [file.name];
        if (file.size !== undefined) {
            parts.push(`Size: ${SessionFileItem.formatSize(file.size)}`);
        }
        if (file.modified) {
            parts.push(`Modified: ${new Date(file.modified).toLocaleString()}`);
        }
        return parts.join('\n');
    }
}

export class PlaceholderItem extends vscode.TreeItem {
    constructor(label: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'placeholder';
        this.iconPath = new vscode.ThemeIcon('info');
    }
}
