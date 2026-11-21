import express from "express";
import multer from "multer";
import {
  create,
  respond,
  uploadEvidence,
  resolve,
} from "./disputeController";

const router = express.Router();
const upload = multer();

router.post("/", create);
router.post("/:id/respond", respond);
router.post("/:id/evidence", upload.single("file"), uploadEvidence);
router.post("/:id/resolve", resolve);

export default router;