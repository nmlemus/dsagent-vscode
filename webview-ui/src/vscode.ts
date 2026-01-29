interface VSCodeAPI {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

class VSCodeWrapper {
  private readonly vscodeApi: VSCodeAPI;

  constructor() {
    if (typeof acquireVsCodeApi === 'function') {
      this.vscodeApi = acquireVsCodeApi();
    } else {
      // Mock for development outside VS Code
      this.vscodeApi = {
        postMessage: (message) => console.log('postMessage:', message),
        getState: () => undefined,
        setState: (state) => console.log('setState:', state),
      };
    }
  }

  public postMessage(message: unknown): void {
    this.vscodeApi.postMessage(message);
  }

  public getState<T>(): T | undefined {
    return this.vscodeApi.getState() as T | undefined;
  }

  public setState<T>(state: T): void {
    this.vscodeApi.setState(state);
  }
}

export const vscode = new VSCodeWrapper();
