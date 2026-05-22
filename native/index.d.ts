export function countTokens(text: string): number;
export function createDiff(original: string, modified: string): string;
export function applyPatch(content: string, search: string, replace: string): string;
export function compactContext(text: string, maxTokens: number): string;
