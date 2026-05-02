import { Injectable } from '@nestjs/common';
import {
  ExpenseStatus,
  InvoiceStatus,
  InvoiceType,
  SalaryAdvanceStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  private round2(value: number) {
    return Math.round(value * 100) / 100;
  }

  private getRange(days: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    return { start, end };
  }

  async getExpenseAnomalies(companyId: string) {
    const { start } = this.getRange(30);
    const expenses = await this.prisma.expenseEntry.findMany({
      where: {
        companyId,
        deletedAt: null,
        expenseDate: { gte: start },
        status: { not: ExpenseStatus.REJECTED },
      },
      select: {
        id: true,
        expenseDate: true,
        amount: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { expenseDate: 'desc' },
      take: 200,
    });

    if (expenses.length === 0) return [];

    const amounts = expenses.map((entry) => Number(entry.amount));
    const mean =
      amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
    const variance =
      amounts.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
      Math.max(1, amounts.length - 1);
    const stdDev = Math.sqrt(variance);
    const threshold = Math.max(mean * 2.5, mean + stdDev * 2);

    return expenses
      .filter((entry) => Number(entry.amount) >= threshold)
      .slice(0, 6)
      .map((entry) => ({
        id: entry.id,
        source: 'EXPENSE_ANOMALY',
        title: `${entry.category?.name || 'Expense'} spike detected`,
        description: `Expense of INR ${this.round2(Number(entry.amount))} on ${entry.expenseDate
          .toISOString()
          .slice(0, 10)} exceeds recent averages.`,
        impactAmount: Number(entry.amount),
        confidence: 72,
        actionLabel: 'Review expense',
        actionHref: `/dashboard/expenses/${entry.id}`,
        reasons: [
          `Average 30-day expense is INR ${this.round2(mean)}`,
          `Threshold set at INR ${this.round2(threshold)}`,
        ],
        suggestedActions: [
          'Verify supporting proof',
          'Confirm category selection',
        ],
      }));
  }

  async getCostHotspots(companyId: string) {
    const { start } = this.getRange(30);
    const grouped = await this.prisma.expenseEntry.groupBy({
      by: ['categoryId'],
      where: { companyId, deletedAt: null, expenseDate: { gte: start } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 5,
    });

    if (grouped.length === 0) return [];

    const categoryIds = grouped.map((row) => row.categoryId);
    const categories = await this.prisma.expenseCategory.findMany({
      where: { id: { in: categoryIds }, companyId },
      select: { id: true, name: true },
    });
    const categoryMap = new Map(categories.map((cat) => [cat.id, cat.name]));

    return grouped.map((row, idx) => ({
      id: `cost-hotspot-${row.categoryId}-${idx}`,
      source: 'COST_HOTSPOT',
      title: `High spend in ${categoryMap.get(row.categoryId) || 'category'}`,
      description: 'Category spend is trending higher in the last 30 days.',
      impactAmount: Number(row._sum.amount ?? 0),
      confidence: 64,
      actionLabel: 'Open Costing',
      actionHref: '/dashboard/expenses?tab=costing',
      reasons: ['Top category by spend in last 30 days'],
      suggestedActions: ['Review category budget', 'Check allocation accuracy'],
    }));
  }

  async getSalaryAdvanceRisk(companyId: string) {
    const profiles = await this.prisma.salaryProfile.findMany({
      where: { companyId, deletedAt: null, isActive: true },
      select: {
        personId: true,
        monthlyGross: true,
        person: { select: { name: true } },
      },
    });
    if (profiles.length === 0) return [];

    const advances = await this.prisma.salaryAdvance.groupBy({
      by: ['personId'],
      where: {
        companyId,
        deletedAt: null,
        remainingAmount: { gt: 0 },
        status: {
          in: [
            SalaryAdvanceStatus.ACTIVE,
            SalaryAdvanceStatus.PARTIALLY_ADJUSTED,
          ],
        },
      },
      _sum: { remainingAmount: true },
    });

    const advanceMap = new Map(
      advances.map((row) => [
        row.personId,
        Number(row._sum.remainingAmount ?? 0),
      ]),
    );

    return profiles
      .map((profile) => {
        const outstanding = advanceMap.get(profile.personId) ?? 0;
        const monthly = Number(profile.monthlyGross ?? 0);
        const ratio = monthly > 0 ? outstanding / monthly : 0;
        return {
          profile,
          outstanding,
          ratio,
        };
      })
      .filter((entry) => entry.ratio >= 0.8 && entry.outstanding > 0)
      .map((entry, idx) => ({
        id: `advance-risk-${entry.profile.personId}-${idx}`,
        source: 'SALARY_ADVANCE_RISK',
        title: `Advance exposure for ${entry.profile.person?.name || 'worker'}`,
        description:
          'Outstanding advances are high relative to monthly salary.',
        impactAmount: entry.outstanding,
        confidence: 66,
        actionLabel: 'Open Salary & Advances',
        actionHref: '/dashboard/expenses?tab=salary-advances',
        reasons: [
          `Outstanding advances INR ${this.round2(entry.outstanding)}`,
          `Advance ratio ${(entry.ratio * 100).toFixed(1)}%`,
        ],
        suggestedActions: ['Plan deductions', 'Review advance policy'],
      }));
  }

  async getMarginLeakage(companyId: string) {
    const { start } = this.getRange(60);
    const costCenters = await this.prisma.costCenter.findMany({
      where: { companyId, deletedAt: null, isActive: true },
      select: { id: true, name: true, code: true },
    });
    if (costCenters.length === 0) return [];

    const allocationTotals = await this.prisma.costAllocation.groupBy({
      by: ['costCenterId'],
      where: {
        companyId,
        expenseEntry: { expenseDate: { gte: start }, deletedAt: null },
      },
      _sum: { allocatedAmount: true },
    });

    const salesTotals = await this.prisma.invoice.groupBy({
      by: ['costCenterId'],
      where: {
        companyId,
        costCenterId: { not: null },
        status: { not: InvoiceStatus.CANCELLED },
        type: InvoiceType.SALE,
        invoiceDate: { gte: start },
      },
      _sum: { totalAmount: true },
    });

    const purchaseTotals = await this.prisma.invoice.groupBy({
      by: ['costCenterId'],
      where: {
        companyId,
        costCenterId: { not: null },
        status: { not: InvoiceStatus.CANCELLED },
        type: InvoiceType.PURCHASE,
        invoiceDate: { gte: start },
      },
      _sum: { totalAmount: true },
    });

    const allocationsByCenter = new Map(
      allocationTotals.map((row) => [
        row.costCenterId,
        Number(row._sum.allocatedAmount ?? 0),
      ]),
    );
    const salesByCenter = new Map(
      salesTotals.map((row) => [
        row.costCenterId,
        Number(row._sum.totalAmount ?? 0),
      ]),
    );
    const purchasesByCenter = new Map(
      purchaseTotals.map((row) => [
        row.costCenterId,
        Number(row._sum.totalAmount ?? 0),
      ]),
    );

    return costCenters
      .map((center) => {
        const allocation = allocationsByCenter.get(center.id) ?? 0;
        const purchases = purchasesByCenter.get(center.id) ?? 0;
        const sales = salesByCenter.get(center.id) ?? 0;
        const totalCost = allocation + purchases;
        const grossMargin = sales - totalCost;
        const marginPercent = sales > 0 ? (grossMargin / sales) * 100 : 0;
        return {
          center,
          totalCost,
          sales,
          marginPercent,
        };
      })
      .filter((row) => row.sales > 0 && row.marginPercent < 15)
      .slice(0, 6)
      .map((row, idx) => ({
        id: `margin-leakage-${row.center.id}-${idx}`,
        source: 'MARGIN_LEAKAGE',
        title: `Margin pressure in ${row.center.name}`,
        description: 'Gross margin is below target over the last 60 days.',
        impactAmount: this.round2(row.totalCost),
        confidence: 61,
        actionLabel: 'Open Profitability',
        actionHref: '/dashboard/expenses?tab=costing',
        reasons: [
          `Margin ${this.round2(row.marginPercent)}%`,
          `Sales INR ${this.round2(row.sales)}`,
        ],
        suggestedActions: ['Review allocations', 'Check sales pricing'],
      }));
  }
}
