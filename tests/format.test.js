import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const f = require('../js/format.js');

describe('format', () => {
  it('formata euros compactos', () => {
    expect(f.fmtEur(1250000)).toMatch(/^1,3\sM€$/);
    expect(f.fmtEur(350000)).toBe('350 k€');
    expect(f.fmtEur(null)).toBe('—');
  });
  it('evolução e desvio em %', () => {
    expect(f.fmtDelta(f.pctDelta(130000, 100000))).toBe('+30%');
    expect(f.fmtDelta(f.pctDelta(130000, 200000))).toBe('-35%');
    expect(f.pctDelta(10, 0)).toBeNull();
    expect(f.fmtSat(7.25)).toBe('7,3/10');
  });
  it('NPS', () => {
    expect(f.npsOf([10, 9, 7, 3])).toBe(25);
    expect(f.npsOf([])).toBeNull();
  });
  it('filtro de atividade', () => {
    const c = { n_contacts: 0, pipeline_open: 0, pipeline_total: 0, volume_eur: 0, plan_status: null, n_decisors: 3 };
    expect(f.matchesActivity(c, 'none')).toBe(true);
    expect(f.matchesActivity(c, 'decisors')).toBe(true);
    expect(f.matchesActivity(Object.assign({}, c, { pipeline_total: 1 }), 'none')).toBe(false);
  });
  it('nome do PDF da ata', () => {
    expect(f.minuteFileName('Efacec', { contact_date: '2026-11-08', title: 'Reunião de Kick-off!' })).toBe('ata-efacec-2026-11-08-reuniao-de-kick-off.pdf');
  });
});
