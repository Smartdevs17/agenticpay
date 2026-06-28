export interface Transaction {
  id: string;
  amount: number;
  sender: string;
  receiver: string;
  memo?: string;
  tags: string[];
}

export interface TagRule {
  id: string;
  merchantId: string;
  tagName: string;
  memoRegex?: string;
  minAmount?: number;
  maxAmount?: number;
}

export class TaggingService {
  private rules: TagRule[] = [];

  addRule(rule: TagRule) {
    this.rules.push(rule);
  }

  suggestCategory(tx: Transaction): { category: string; confidence: number; explanation: string } {
    const memo = tx.memo?.toLowerCase() || '';
    if (memo.includes('refund')) {
      return { category: 'refund', confidence: 0.95, explanation: "Memo contains keyword 'refund'" };
    }
    if (memo.includes('sub_') || memo.includes('subscription')) {
      return { category: 'subscription', confidence: 0.9, explanation: "Memo matches subscription pattern" };
    }
    if (memo.includes('dispute') || memo.includes('chargeback')) {
      return { category: 'dispute_settlement', confidence: 0.95, explanation: "Memo matches dispute pattern" };
    }
    if (tx.amount < 0.1) {
      return { category: 'fee', confidence: 0.8, explanation: "Small transaction amount typical for fees" };
    }
    return { category: 'payment', confidence: 0.85, explanation: "Standard transfer pattern matching invoice/payment criteria" };
  }

  evaluateRules(merchantId: string, tx: Transaction): string[] {
    const tags = new Set<string>();
    const merchantRules = this.rules.filter(r => r.merchantId === merchantId);

    for (const rule of merchantRules) {
      let matches = true;

      if (rule.memoRegex && tx.memo) {
        try {
          const regex = new RegExp(rule.memoRegex, 'i');
          if (!regex.test(tx.memo)) {
            matches = false;
          }
        } catch {
          matches = false;
        }
      }

      if (rule.minAmount !== undefined && tx.amount < rule.minAmount) {
        matches = false;
      }

      if (rule.maxAmount !== undefined && tx.amount > rule.maxAmount) {
        matches = false;
      }

      if (matches) {
        tags.add(rule.tagName);
      }
    }

    return Array.from(tags);
  }

  bulkEditTags(transactions: Transaction[], tagToAdd?: string, tagToRemove?: string): Transaction[] {
    return transactions.map(tx => {
      let newTags = [...tx.tags];
      if (tagToAdd && !newTags.includes(tagToAdd)) {
        newTags.push(tagToAdd);
      }
      if (tagToRemove) {
        newTags = newTags.filter(t => t !== tagToRemove);
      }
      return { ...tx, tags: newTags };
    });
  }
}
