export { default as disputeRoutes } from "./disputeRoutes.js";
export { disputeService } from "./disputeService.js";
export * from "./disputeModel.js";

// Usage in your main Express app:
//
// import { disputeRoutes } from "./disputes";
// app.use("/api/v1/disputes", disputeRoutes);
//
// Cron job setup (e.g., node-cron):
// import cron from "node-cron";
// import { disputeService } from "./disputes";
// cron.schedule("0 * * * *", async () => {
//   const count = await disputeService.processEscalations();
//   console.log(`[DISPUTES] Escalated ${count} overdue disputes`);
// });
