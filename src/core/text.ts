const NAMED_ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
    ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü',
    iquest: '¿', iexcl: '¡', ordm: 'º', ordf: 'ª', deg: '°',
    ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

export function collapse(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
};

export function deaccent(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

export function decodeEntities(value: string): string {
    return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
        if (!entity.startsWith('#')) {
            // entity names are case sensitive: &Eacute; is not &eacute;
            return NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()] ?? match;
        }

        const isHex = entity[1] === 'x' || entity[1] === 'X';
        const code = isHex ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);

        // String.fromCodePoint throws on anything outside the Unicode range
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    });
};


export function htmlToText(value: string): string {
     // Greenhouse ships the HTML escaped inside the JSON, so the markup only exists after this first decode
    const markup = decodeEntities(value);

    const stripped = markup
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|ul|ol|tr|h[1-6]|section|article)\s*>/gi, '\n')
        .replace(/<[^>]*>/g, '');

    // entities that were double escaped ("&amp;amp;") only surface now
    return decodeEntities(stripped)
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};
