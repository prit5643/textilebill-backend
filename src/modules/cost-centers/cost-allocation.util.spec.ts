import {
  getRemainingAllocatableAmount,
  isAllocationWithinSourceExpense,
} from './cost-allocation.util';

describe('cost-allocation.util', () => {
  describe('isAllocationWithinSourceExpense', () => {
    it('returns true when requested allocation fits within expense amount', () => {
      expect(isAllocationWithinSourceExpense(1000, 350, 650)).toBe(true);
      expect(isAllocationWithinSourceExpense(1000, 0, 1000)).toBe(true);
    });

    it('returns false when requested allocation exceeds expense amount', () => {
      expect(isAllocationWithinSourceExpense(1000, 800, 201)).toBe(false);
    });
  });

  describe('getRemainingAllocatableAmount', () => {
    it('returns remaining allocatable amount', () => {
      expect(getRemainingAllocatableAmount(1000, 640)).toBe(360);
    });

    it('never returns negative values', () => {
      expect(getRemainingAllocatableAmount(1000, 1200)).toBe(0);
    });
  });
});

