import * as vscode from 'vscode';
import { DSAgentClient } from '../api/client';
import type { Artifact } from '../api/types';

/** Map artifact.type to a display category */
const CATEGORY_MAP: Record<string, string> = {
    image: 'Images',
    csv: 'Data Files',
    data: 'Data Files',
    json: 'Data Files',
    parquet: 'Data Files',
    excel: 'Data Files',
    notebook: 'Notebooks',
    html: 'Reports',
    pdf: 'Reports',
    model: 'Models',
    pickle: 'Models',
};

const CATEGORY_ICONS: Record<string, vscode.ThemeIcon> = {
    'Images': new vscode.ThemeIcon('file-media', new vscode.ThemeColor('charts.purple')),
    'Data Files': new vscode.ThemeIcon('table', new vscode.ThemeColor('charts.blue')),
    'Notebooks': new vscode.ThemeIcon('notebook', new vscode.ThemeColor('charts.orange')),
    'Reports': new vscode.ThemeIcon('globe', new vscode.ThemeColor('charts.green')),
    'Models': new vscode.ThemeIcon('beaker', new vscode.ThemeColor('charts.red')),
    'Other': new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.yellow')),
};

/** Order in which categories appear */
const CATEGORY_ORDER = ['Images', 'Data Files', 'Notebooks', 'Models', 'Reports', 'Other'];

type ArtifactTreeItem = CategoryItem | ArtifactItem;

export class ArtifactsTreeProvider implements vscode.TreeDataProvider<ArtifactTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ArtifactTreeItem | undefined | null | void> =
        new vscode.EventEmitter<ArtifactTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ArtifactTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private artifacts: Artifact[] = [];

    constructor(private readonly client: DSAgentClient) {
        this.client.on('sessionCreated', () => this.refresh());
        this.client.on('sessionResumed', () => this.refresh());

        this.client.on('code_result', () => {
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

    getTreeItem(element: ArtifactTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ArtifactTreeItem): Promise<ArtifactTreeItem[]> {
        // Children of a category → its artifacts
        if (element instanceof CategoryItem) {
            return element.children;
        }

        // Children of an artifact → none
        if (element instanceof ArtifactItem) {
            return [];
        }

        // Root level
        if (!this.client.session) {
            return [ArtifactItem.placeholder('No active session')];
        }

        await this.loadArtifacts();

        if (this.artifacts.length === 0) {
            return [ArtifactItem.placeholder('No artifacts yet')];
        }

        // Group artifacts by category
        const groups = new Map<string, Artifact[]>();
        for (const artifact of this.artifacts) {
            const category = CATEGORY_MAP[artifact.type] || 'Other';
            if (!groups.has(category)) {
                groups.set(category, []);
            }
            groups.get(category)!.push(artifact);
        }

        // Build category items in defined order
        const categories: CategoryItem[] = [];
        for (const cat of CATEGORY_ORDER) {
            const items = groups.get(cat);
            if (items && items.length > 0) {
                // Sort within category: newest first
                items.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
                categories.push(new CategoryItem(cat, items));
            }
        }

        // If only one category, show artifacts directly (skip the group level)
        if (categories.length === 1) {
            return categories[0].children;
        }

        return categories;
    }
}

export class CategoryItem extends vscode.TreeItem {
    public readonly children: ArtifactItem[];

    constructor(category: string, artifacts: Artifact[]) {
        super(category, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'artifactCategory';
        this.iconPath = CATEGORY_ICONS[category] || CATEGORY_ICONS['Other'];
        this.description = `${artifacts.length}`;
        this.children = artifacts.map(a => new ArtifactItem(a));
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
            case 'json':
            case 'parquet':
            case 'excel':
                return new vscode.ThemeIcon('table', new vscode.ThemeColor('charts.blue'));
            case 'notebook':
                return new vscode.ThemeIcon('notebook', new vscode.ThemeColor('charts.orange'));
            case 'html':
            case 'pdf':
                return new vscode.ThemeIcon('globe', new vscode.ThemeColor('charts.green'));
            case 'model':
            case 'pickle':
                return new vscode.ThemeIcon('beaker', new vscode.ThemeColor('charts.red'));
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
