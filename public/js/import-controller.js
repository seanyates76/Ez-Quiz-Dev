export class ImportController {
  constructor() {
    this.currentToken = 0;
    this.abortController = null;
    this.pending = false;
  }

  start() {
    this.currentToken += 1;
    const token = this.currentToken;
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {
        // ignore abort errors from previous controller
      }
    }
    this.abortController = new AbortController();
    this.pending = true;
    return { token, signal: this.abortController.signal };
  }

  isCurrent(token) {
    return token === this.currentToken;
  }

  finish(token) {
    if (this.isCurrent(token)) {
      this.pending = false;
      this.abortController = null;
    }
  }

  cancel() {
    this.currentToken += 1;
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {
        // ignore abort errors from current controller
      }
    }
    this.abortController = null;
    this.pending = false;
  }
}
