import * as vscode from 'vscode';
import { DSAgentClient } from '../api/client';
import type { Artifact } from '../api/types';

export class ArtifactsTreeProvider implements vscode.TreeDataProvider<ArtifactItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ArtifactItem | undefined | null | void> =
        new vscode.EventEmitter<ArtifactItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ArtifactItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private artifacts: Artifact[] = [];

    constructor(private readonly client: DSAgentClient) {
        // Refresh when a session is resumed or created
        this.client.on('sessionCreated', () => this.refresh());
        this.client.on('sessionResumed', () => this.refresh());

        // Refresh after code execution completes (new artifacts may have been created)
        this.client.on('code_result', () => {
            // Debounce: wait for the kernel to flush files to disk
            setTimeout(() => this.refresh(), 2000);
        });

        this.client.on('complete', () => this.refresh());
    }

    refresh(): void {
        this.loadArtifacts().then(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    private async loadArtifacts(): Promise<void> {
        try {
            this.artifacts = await this.client.listArtifacts();
        } catch {
            this.artifacts = [];
        }
    }

    getTreeItem(element: ArtifactItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ArtifactItem): Promise<ArtifactItem[]> {
        if (element) {
            return [];
        }

        if (!this.client.session) {
            return [ArtifactItem.placeholder('No active session')];
        }

        await this.loadArtifacts();

        if (this.artifacts.length === 0) {
            return [ArtifactItem.placeholder('No artifacts yet')];
        }

        // Sort by modified date descending (newest first)
        const sorted = [...this.artifacts].sort(
            (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()
        );

        return sorted.map(artifact => new ArtifactItem(artifact));
    }
}

export class ArtifactItem extends vscode.TreeItem {
    public readonly artifact?: Artifact;

    constructor(artifact: Artifact);
    constructor(label: string, isPlaceholder: true);
    constructor(artifactOrLabel: Artifact | string, isPlaceholder?: boolean) {
        if (typeof artifactOrLabel === 'string') {
            super(artifactOrLabel, vscode.TreeItemCollapsibleState.None);
            this.contextValue = 'placeholder';
            this.iconPath = new vscode.ThemeIcon('info');
            return;
        }

        const artifact = artifactOrLabel;
        super(artifact.name, vscode.TreeItemCollapsibleState.None);
        this.artifact = artifact;
        this.contextValue = 'artifact';
        this.tooltip = ArtifactItem.buildTooltip(artifact);
        this.description = ArtifactItem.formatSize(artifact.size);
        this.iconPath = ArtifactItem.iconForType(artifact);

        // Click to open/preview the artifact
        this.command = {
            command: 'dsagent.openArtifact',
            title: 'Open Artifact',
            arguments: [artifact],
        };
    }

    static placeholder(text: string): ArtifactItem {
        return new ArtifactItem(text, true);
    }

    private static iconForType(artifact: Artifact): vscode.ThemeIcon {
        switch (artifact.type) {
            case 'image':
                return new vscode.ThemeIcon('file-media', new vscode.ThemeColor('charts.purple'));
            case 'csv':
            case 'data':
                return new vscode.ThemeIcon('table', new vscode.ThemeColor('charts.blue'));
            case 'notebook':
                return new vscode.ThemeIcon('notebook', new vscode.ThemeColor('charts.orange'));
            case 'html':
                return new vscode.ThemeIcon('globe', new vscode.ThemeColor('charts.green'));
            default:
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.yellow'));
        }
    }

    private static formatSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    private static buildTooltip(artifact: Artifact): string {
        const date = new Date(artifact.modified);
        return [
            artifact.name,
            `Type: ${artifact.type}`,
            `Size: ${ArtifactItem.formatSize(artifact.size)}`,
            `Modified: ${date.toLocaleString()}`,
        ].join('\n');
    }
}
