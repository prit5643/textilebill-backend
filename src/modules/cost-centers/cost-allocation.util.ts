export function getRemainingAllocatableAmount(
  sourceExpenseAmount: number,
  currentAllocatedAmount: number,
) {
  return Math.max(0, Number(sourceExpenseAmount || 0) - Number(currentAllocatedAmount || 0));
}

export function isAllocationWithinSourceExpense(
  sourceExpenseAmount: number,
  currentAllocatedAmount: number,
  requestedAmount: number,
) {
  const nextAllocatedAmount =
    Number(currentAllocatedAmount || 0) + Number(requestedAmount || 0);
  return nextAllocatedAmount - Number(sourceExpenseAmount || 0) <= 0.0001;
}

