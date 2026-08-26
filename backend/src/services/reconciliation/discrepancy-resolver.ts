import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function resolveDiscrepancies(reportId: string) {
  const discrepancies = await prisma.reconciliationDiscrepancy.findMany({
    where: { reportId, resolved: false }
  });

  for (const disc of discrepancies) {
    const diff = Number(disc.difference);

    // Auto-resolve small differences (e.g., gas fees rounding)
    if (diff < 0.001) {
      await prisma.reconciliationDiscrepancy.update({
        where: { id: disc.id },
        data: {
          resolved: true,
          resolutionReason: 'Auto-resolved: difference within acceptable rounding threshold'
        }
      });
    } else if (diff > 0.01) {
      // Trigger alert for significant discrepancies (>0.01 ETH)
      await triggerAlert(disc);
    }
  }
}

async function triggerAlert(discrepancy: any) {
  // Mock webhook integration
  console.log(`[ALERT] Significant discrepancy detected for wallet ${discrepancy.walletAddress}. Difference: ${discrepancy.difference} ${discrepancy.currency}`);
  
  // Example Webhook POST (mocked)
  // await fetch('https://example.com/webhook', {
  //   method: 'POST',
  //   body: JSON.stringify({ text: `Alert: Balance discrepancy of ${discrepancy.difference} ${discrepancy.currency} for ${discrepancy.walletAddress}`})
  // });
}
