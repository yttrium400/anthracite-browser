declare module 'adblock-rs' {
    export class FilterSet {
        constructor(debug?: boolean);
        addFilters(lines: string[]): void;
    }

    export class Engine {
        constructor(filterSet: FilterSet, debug?: boolean);
        check(url: string, sourceUrl: string, requestType: string, debug?: false): boolean;
        check(url: string, sourceUrl: string, requestType: string, debug: true): { matched: boolean; redirect?: string; exception?: string; filter?: string; important?: boolean; rewritten_url?: string };

        static deserialize(buffer: Buffer): Engine;
        serialize(): Buffer;

        // Cosmetic filtering
        // Based on adblock-rust source code, these might be different.
        // But for now, let's assume standard behavior or check source if possible.
        // Actually, js/index.js shows: urlCosmeticResources, hiddenClassIdSelectors
        urlCosmeticResources(url: string): { hide_selectors?: string[]; style_selectors?: string[]; injected_script?: string };
        hiddenClassIdSelectors(classes: string[], ids: string[], exceptions: string[]): string[];
        useResources(resources: any): void;
    }
}
