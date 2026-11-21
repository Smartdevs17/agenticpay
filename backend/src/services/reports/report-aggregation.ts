export type ReportPayment = {
  amount: unknown;
  status: string;
  currency: string;
  network: string;
  createdAt: Date;
  projectId?: string | null;
  toAddress?: string | null;
  userId?: string | null;
  fromAddress?: string | null;
};

function dimensionValue(payment: ReportPayment, dimension: string): string {
  if (dimension === "date") return payment.createdAt.toISOString().slice(0, 10);
  if (dimension === "chain") return payment.network;
  if (dimension === "merchant")
    return payment.projectId ?? payment.toAddress ?? "unknown";
  return String(payment[dimension as keyof ReportPayment] ?? "unknown");
}

export function buildReportRows(
  payments: ReportPayment[],
  metrics: string[],
  dimensions: string[],
) {
  const buckets = new Map<
    string,
    { dimensions: Record<string, string>; payments: ReportPayment[] }
  >();
  for (const payment of payments) {
    const values = Object.fromEntries(
      dimensions.map((dimension) => [
        dimension,
        dimensionValue(payment, dimension),
      ]),
    );
    const key = JSON.stringify(values);
    const bucket = buckets.get(key) ?? { dimensions: values, payments: [] };
    bucket.payments.push(payment);
    buckets.set(key, bucket);
  }

  return [...buckets.values()].map((bucket) => {
    const amounts = bucket.payments.map((payment) => Number(payment.amount));
    const completed = bucket.payments.filter(
      (payment) => payment.status === "completed",
    ).length;
    const values: Record<string, number> = {};
    for (const metric of metrics) {
      if (metric === "request_count" || metric === "tx_count")
        values[metric] = bucket.payments.length;
      if (metric === "total_amount" || metric === "revenue")
        values[metric] = amounts.reduce((sum, amount) => sum + amount, 0);
      if (metric === "success_rate")
        values[metric] = bucket.payments.length
          ? (completed / bucket.payments.length) * 100
          : 0;
      if (metric === "unique_users")
        values[metric] = new Set(
          bucket.payments
            .map((payment) => payment.userId ?? payment.fromAddress)
            .filter(Boolean),
        ).size;
      if (metric === "fees" || metric === "avg_latency") values[metric] = 0;
    }
    return { ...bucket.dimensions, ...values };
  });
}
