import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as demoController from '../controllers/demoController.js';

const router = express.Router();
router.use(authenticate);

router.get('/', demoController.getDemoAccount);
router.post('/reset', demoController.resetDemoAccount);
router.get('/performance', demoController.getDemoPerformance);

export default router;
