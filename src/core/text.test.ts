import { describe, expect, it } from 'vitest';
import { collapse, deaccent, decodeEntities, htmlToText } from './text.js';

describe('collapse', () => {
    it('trims and squeezes any run of whitespace', () => {
        expect(collapse('  Senior   Node\n\tEngineer  ')).toBe('Senior Node Engineer');
    });
});

describe('deaccent', () => {
    it('strips the marks and leaves the letters', () => {
        expect(deaccent('Bogotá, Medellín, Señor')).toBe('Bogota, Medellin, Senor');
    });
});

describe('decodeEntities', () => {
    it('decodes the named entities', () => {
        expect(decodeEntities('R&amp;D &lt;b&gt; caf&eacute;')).toBe('R&D <b> café');
    });

    it('decodes decimal and hexadecimal references', () => {
        expect(decodeEntities('&#39;x&#39; &#x2F; y')).toBe("'x' / y");
    });

    it('keeps the case of the entity, because HTML entities are case sensitive', () => {
        expect(decodeEntities('&Eacute;cole &eacute;cole')).toBe('École école');
    });

    it('falls back to the lowercase table for the basic ones', () => {
        expect(decodeEntities('a &AMP; b')).toBe('a & b');
    });

    it('leaves alone what it does not know', () => {
        expect(decodeEntities('&notanentity; &#999999999999;')).toBe('&notanentity; &#999999999999;');
    });
});

describe('htmlToText', () => {
    // What Greenhouse really sends: HTML that was escaped before being put in the JSON string
    const escaped =
        '&lt;p&gt;R&amp;amp;D team&lt;/p&gt;&lt;script&gt;evil()&lt;/script&gt;' +
        '&lt;ul&gt;&lt;li&gt;Node&lt;/li&gt;&lt;li&gt;TS&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;Caf&amp;eacute;&lt;/p&gt;';

    it('decodes twice, so the entities inside the markup come out too', () => {
        const text = htmlToText(escaped);

        expect(text).toContain('R&D team');
        expect(text).toContain('Café');
        expect(text).not.toContain('&amp;');
    });

    it('drops script and style with everything inside them', () => {
        expect(htmlToText(escaped)).not.toContain('evil()');
    });

    it('turns block ends into line breaks and keeps them', () => {
        expect(htmlToText(escaped).split('\n').filter(Boolean)).toEqual([
            'R&D team',
            'Node',
            'TS',
            'Café',
        ]);
    });

    it('does not leave more than one blank line in a row', () => {
        expect(htmlToText('&lt;p&gt;a&lt;/p&gt;&lt;p&gt;&lt;/p&gt;&lt;p&gt;&lt;/p&gt;&lt;p&gt;b&lt;/p&gt;')).toBe(
            'a\n\nb'
        );
    });

    it('handles plain unescaped HTML too', () => {
        expect(htmlToText('<p>Hello<br>world</p>')).toBe('Hello\nworld');
    });
});
