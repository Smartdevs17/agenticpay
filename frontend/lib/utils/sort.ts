export function sortList<T>(
  items: T[],
  sortBy: keyof T,
  sortOrder: 'asc' | 'desc'
): T[] {
  return [...items].sort((a, b) => {
    let aValue = a[sortBy];
    let bValue = b[sortBy];

    // Handle null/undefined values
    if (aValue == null) aValue = '';
    if (bValue == null) bValue = '';

    let comparison = 0;

    // Date fields: compare as Date objects
    if (
      sortBy === 'createdAt' ||
      sortBy === 'generatedAt' ||
      sortBy === 'date' ||
      sortBy === 'timestamp' ||
      sortBy === 'paidAt'
    ) {
      const aDate = new Date(aValue as string);
      const bDate = new Date(bValue as string);
      comparison = aDate.getTime() - bDate.getTime();
    }
    // Amount fields: compare as numbers
    else if (
      sortBy === 'totalAmount' ||
      sortBy === 'amount' ||
      sortBy === 'depositedAmount'
    ) {
      // Parse string amounts to numbers (handle ETH/ERC20 formatting)
      const aNum = parseFloat((aValue as string).replace(/[^0-9.-]/g, ''));
      const bNum = parseFloat((bValue as string).replace(/[^0-9.-]/g, ''));
      comparison = aNum - bNum;
    }
    // Status fields: compare as strings alphabetically
    else {
      comparison = String(aValue).localeCompare(String(bValue));
    }

    // Apply sort order
    return sortOrder === 'desc' ? -comparison : comparison;
  });
}
