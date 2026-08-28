import { Prisma } from '@prisma/client';
import prisma from '../../utils/prisma/prisma-client';
import ApiError from '../../utils/errors/api-error';
import type { CreateCustomerInput, UpdateCustomerInput } from './customers.validation';

/**
 * The customer directory.
 *
 * Buyers are records rather than free text so that profit-per-customer means
 * something — "Rahim Traders" and "Rahim traders" typed into a box would be two
 * different buyers and the report would be worthless.
 */
export const customerServices = {
  getMany: async (query: { search?: string; type?: string; includeInactive?: boolean }) => {
    const where: Prisma.CustomerWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.type ? { type: query.type as any } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const customers = await prisma.customer.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { dispositions: true } } },
    });

    return { customers, totalData: customers.length };
  },

  getById: async (id: string) => {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: { _count: { select: { dispositions: true } } },
    });
    if (!customer) throw ApiError.notFound('Customer not found');
    return customer;
  },

  create: async (payload: CreateCustomerInput, userId: string) =>
    prisma.customer.create({ data: { ...payload, createdById: userId } }),

  update: async (id: string, payload: UpdateCustomerInput) => {
    await customerServices.getById(id);
    return prisma.customer.update({ where: { id }, data: payload });
  },

  /**
   * Customers are deactivated, never deleted, so the dispositions that name
   * them keep their buyer. Only a customer that has never bought anything is
   * removed outright.
   */
  remove: async (id: string) => {
    const customer = await customerServices.getById(id);
    if (customer._count.dispositions > 0) {
      const deactivated = await prisma.customer.update({ where: { id }, data: { isActive: false } });
      return { deactivated: true, customer: deactivated };
    }
    await prisma.customer.delete({ where: { id } });
    return { deactivated: false, customer };
  },
};
