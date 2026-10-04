import { describe, expect, it } from 'vitest';
import { brandingStyle, hexToHslTriple } from './branding';

describe('club branding', () => {
  it('converts plain hex colours to theme triples', () => {
    expect(hexToHslTriple('#ff0000')?.triple).toBe('0 100% 50%');
    expect(hexToHslTriple('#000000')?.triple).toBe('0 0% 0%');
    expect(hexToHslTriple('#ffffff')?.triple).toBe('0 0% 100%');
    expect(hexToHslTriple('#1A73E8')?.triple).toBe('214 82% 51%');
  });

  it('refuses anything that is not a plain hex colour, so CSS cannot be injected', () => {
    for (const bad of ['red', '#fff', '#12345g', 'red; background:url(//evil)', 'url(javascript:alert(1))', '#ff0000;}', '']) {
      expect(hexToHslTriple(bad), bad).toBeNull();
    }
    expect(brandingStyle({ primaryColor: 'red; x:y', secondaryColor: null, accentColor: '#12345' })).toEqual({});
  });

  it('picks readable foregrounds and leaves unset colours alone', () => {
    const style = brandingStyle({ primaryColor: '#ffee00', secondaryColor: null, accentColor: '#101820' });
    expect(style['--primary-foreground']).toBe('240 10% 4%');
    expect(style['--accent-foreground']).toBe('0 0% 98%');
    expect(style['--secondary']).toBeUndefined();
    expect(brandingStyle(null)).toEqual({});
  });
});
