import express from "express";
import disputeRoutes from "../disputes/disputeRoutes";
import { disputeService } from "../disputes/disputeService";

const app = express();
app.use(express.json());

// fake auth middleware (needed!)
app.use((req, res, next) => {
  req.user = { id: "user_1", role: "arbitrator" }; // change as needed
  next();
});

app.use("/api/v1/disputes", disputeRoutes);

// ✅ AUTO ESCALATION
setInterval(async () => {
  const count = await disputeService.processEscalations();
  if (count > 0) console.log(`Escalated ${count} disputes`);
}, 5 * 60 * 1000);

app.listen(3000, () => console.log("Server running"));