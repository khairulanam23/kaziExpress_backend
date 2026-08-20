import { Router } from 'express';
import { getDashboardOverview } from './dashboard.controller';
import { validateDashboardQuery } from './dashboard.validation';
import isAuthorized from '../../middlewares/is-authorized';

const router = Router();

router.use(isAuthorized);

/** @route GET /api/v1/dashboard/overview — Dashboard overview (Admin or Employee-scoped) */
router.get('/overview', validateDashboardQuery, getDashboardOverview);

module.exports = router;
