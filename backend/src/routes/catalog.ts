import { Router } from 'express';
import { getCatalog } from '../services/catalog.js';

export const catalogRouter = Router();

catalogRouter.get('/', (req, res) => {
  try {
    const catalog = getCatalog();
    res.json(catalog);
  } catch (error) {
    console.error('Catalog error:', error);
    res.status(500).json({ message: 'Failed to fetch catalog' });
  }
});
