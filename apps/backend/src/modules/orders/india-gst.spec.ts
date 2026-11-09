import {
  gstinStateCode,
  isValidFssai,
  isValidGstin,
  isValidHsnSac,
  splitIndiaGst,
} from '@nodedr-restaurant/types';

// Branch in Maharashtra (27), customer GSTIN from Karnataka (29).
const BRANCH_GSTIN = '27AAPFU0939F1ZV';
const KARNATAKA_GSTIN = '29AAPFU0939F1ZV';

describe('splitIndiaGst', () => {
  it('same state: CGST + SGST halves', () => {
    expect(
      splitIndiaGst(10, { branchStateCode: '27', placeOfSupplyStateCode: '27' }),
    ).toEqual([
      { label: 'CGST', amount: 5 },
      { label: 'SGST', amount: 5 },
    ]);
  });

  it('other state: the full amount as IGST', () => {
    expect(
      splitIndiaGst(10, { branchStateCode: '27', placeOfSupplyStateCode: '29' }),
    ).toEqual([{ label: 'IGST', amount: 10 }]);
  });

  it('no place of supply: CGST + SGST', () => {
    expect(splitIndiaGst(10, { branchStateCode: '27' }).map((l) => l.label)).toEqual([
      'CGST',
      'SGST',
    ]);
  });

  it('rounding: odd paise go to SGST and the lines add up exactly', () => {
    const lines = splitIndiaGst(10.01, { branchStateCode: '27' });
    expect(lines).toEqual([
      { label: 'CGST', amount: 5.01 },
      { label: 'SGST', amount: 5 },
    ]);
    expect(lines[0].amount + lines[1].amount).toBeCloseTo(10.01, 10);
  });
});

describe('India GST validators', () => {
  it('GSTIN: valid format and state code; derives the state', () => {
    expect(isValidGstin(BRANCH_GSTIN)).toBe(true);
    expect(isValidGstin('27aapfu0939f1zv')).toBe(true);
    expect(isValidGstin('99AAPFU0939F1ZV')).toBe(false);
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false);
    expect(gstinStateCode(KARNATAKA_GSTIN)).toBe('29');
    expect(gstinStateCode('not-a-gstin')).toBeNull();
  });

  it('HSN/SAC: 4 to 8 digits only', () => {
    expect(isValidHsnSac('996331')).toBe(true);
    expect(isValidHsnSac('2106')).toBe(true);
    expect(isValidHsnSac('123')).toBe(false);
    expect(isValidHsnSac('123456789')).toBe(false);
    expect(isValidHsnSac('99633A')).toBe(false);
  });

  it('FSSAI: exactly 14 digits', () => {
    expect(isValidFssai('12345678901234')).toBe(true);
    expect(isValidFssai('1234567890123')).toBe(false);
    expect(isValidFssai('1234567890123A')).toBe(false);
  });
});
