import { Router } from 'express';
import isAuthorized from '../../middlewares/is-authorized';
import { requirePermission } from '../../middlewares/require-permission';
import * as categoryController from './categories.controller';

const router = Router();

router.use(isAuthorized);

// GET /categories — list all
router.get('/', requirePermission('CATEGORY_VIEW'), categoryController.getManyCategories);

// GET /categories/:id
router.get('/:id', requirePermission('CATEGORY_VIEW'), categoryController.getCategoryById);

// POST /categories
router.post('/', requirePermission('CATEGORY_CREATE'), categoryController.createCategory);

// PATCH /categories/:id
router.patch('/:id', requirePermission('CATEGORY_UPDATE'), categoryController.updateCategory);

// DELETE /categories/:id
router.delete('/:id', requirePermission('CATEGORY_DELETE'), categoryController.deleteCategory);

module.exports = router;
