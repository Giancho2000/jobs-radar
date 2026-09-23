export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigError';
    }
}

export class StoreError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StoreError';
    }
}

export class ScoringError extends Error {
    // A malformed answer is worth asking again; a refusal or a rejected request is not.
    readonly retryable: boolean;

    constructor(message: string, retryable = true) {
        super(message);
        this.name = 'ScoringError';
        this.retryable = retryable;
    }
}
