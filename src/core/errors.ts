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
