import { describe, expect, it } from 'vitest';
import { amountInWords } from './amountWords';

// The amount in words on the counterfoil (docs/design/10_visual_v2.md, AC-ORD-1; U10-14).
describe('the amount in words', () => {
  it.each([
    [100n, 'One taka only'],
    [2_500_000n, 'Twenty-five thousand taka only'],
    [1_200_000n, 'Twelve thousand taka only'],
    [10_000n, 'One hundred taka only'],
    [10_500n, 'One hundred and five taka only'],
    [12_535_050n, 'One lakh twenty-five thousand three hundred and fifty taka and fifty poisha only'],
    [1_000_000_000n, 'One crore taka only'],
    [123_456_789_000n, 'One hundred and twenty-three crore forty-five lakh sixty-seven thousand eight hundred and ninety taka only'],
    [99n, 'Zero taka and ninety-nine poisha only'],
  ])('NFR-USE-07 %s poisha reads in English as "%s"', (poisha, words) => {
    expect(amountInWords(poisha, 'en')).toBe(words);
  });

  it.each([
    [2_500_000n, 'পঁচিশ হাজার টাকা মাত্র'],
    [12_535_050n, 'এক লাখ পঁচিশ হাজার তিন শত পঞ্চাশ টাকা পঞ্চাশ পয়সা মাত্র'],
    [9_999_900n, 'নিরানব্বই হাজার নয় শত নিরানব্বই টাকা মাত্র'],
    [1_000_000_000n, 'এক কোটি টাকা মাত্র'],
    [4_100n, 'একচল্লিশ টাকা মাত্র'],
  ])('NFR-USE-04 %s poisha reads in Bangla as "%s"', (poisha, words) => {
    expect(amountInWords(poisha, 'bn')).toBe(words);
  });

  it('NFR-USE-07 takes the amount as a string of poisha, as the API sends it, and refuses a negative amount', () => {
    expect(amountInWords('1500000', 'en')).toBe('Fifteen thousand taka only');
    expect(() => amountInWords(-1n, 'en')).toThrow(RangeError);
  });
});
