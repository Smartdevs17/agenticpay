import { disputeService } from "./disputeService";

export const create = async (req, res) => {
  try {
    const data = await disputeService.create(req.body, req.user.id);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

export const respond = async (req, res) => {
  const data = await disputeService.respond(
    req.params.id,
    req.user.id,
    req.body.content
  );
  res.json(data);
};

export const uploadEvidence = async (req, res) => {
  const data = await disputeService.addEvidence(
    req.params.id,
    req.user.id,
    {
      url: `/uploads/${req.file.originalname}`,
      name: req.file.originalname,
      size: req.file.size,
      description: req.body.description,
    }
  );

  res.json(data);
};

export const resolve = async (req, res) => {
  try {
    const data = await disputeService.resolve(
      req.params.id,
      req.user,
      req.body
    );
    res.json(data);
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
};