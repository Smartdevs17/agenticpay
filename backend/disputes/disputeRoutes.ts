import express from "express";
import multer from "multer";
import {
  create,
  respond,
  uploadEvidence,
  resolve,
  getAnalytics,
} from "./disputeController.js";

const router = express.Router();
// In-memory storage: evidence files are re-hosted at a stable URL by the
// upload handler itself (see disputeController.uploadEvidence), not served
// directly from multer's buffer.
const upload = multer();

router.post("/", create);
router.get("/analytics", getAnalytics);
router.post("/:id/respond", respond);
router.post("/:id/evidence", upload.single("file"), uploadEvidence);
router.post("/:id/resolve", resolve);

export default router;
