import PDFDocument from 'pdfkit';

/**
 * Shared document theme and layout engine for every generated PDF.
 *
 * Each report previously hand-positioned its own text at fixed coordinates,
 * which produced inconsistent typography, silently clipped long values, had no
 * page numbering, and truncated tables at 30 rows. This module centralises the
 * letterhead, section headings, KPI strip, table engine and footer so reports
 * only describe their *content*.
 *
 * The table engine measures every cell before drawing it, so rows grow to fit
 * wrapped text, page breaks never split a row, and the header band repeats at
 * the top of each continuation page.
 */

// ── Palette (mirrors the application's own tokens) ─────────────────────────
export const THEME = {
  ink: '#0F172A',
  inkSoft: '#334155',
  inkMute: '#64748B',
  line: '#E2E8F0',
  lineStrong: '#CBD5E1',
  band: '#F1F5F9',
  zebra: '#F8FAFC',
  brand: '#4E42D9',
  brandInk: '#3B31B0',
  brandSoft: '#EEECFF',
  success: '#0F7A57',
  warning: '#9A6410',
  danger: '#B42318',
  white: '#FFFFFF',
} as const;

const PAGE = { size: 'A4' as const, margin: 40, width: 595.28, height: 841.89 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2; // 515.28
const FOOTER_SPACE = 46;
const BOTTOM_LIMIT = PAGE.height - PAGE.margin - FOOTER_SPACE;

export type Align = 'left' | 'right' | 'center';

export interface PdfColumn {
  header: string;
  /** Share of the content width; all widths in a table are normalised. */
  width: number;
  align?: Align;
}

export interface OrganizationHeader {
  name: string;
  legalName?: string | null;
  addressLine?: string | null;
  city?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  registrationNumber?: string | null;
}

export interface PdfDocOptions {
  title: string;
  subtitle?: string;
  organization?: OrganizationHeader | null;
  /** Label/value pairs rendered in the metadata band under the letterhead. */
  meta?: [string, string][];
}

// ── Formatting helpers (shared so every report reads identically) ──────────

export const fmtMoney = (value: unknown, currency = 'BDT'): string => {
  const n = Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  return `${currency} ${safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const fmtNumber = (value: unknown, dp = 0): string => {
  const n = Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
};

/** Quantities keep up to 3 decimals but drop trailing zeros. */
export const fmtQty = (value: unknown, unit?: string | null): string => {
  const n = Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const text = safe.toLocaleString('en-US', { maximumFractionDigits: 3 });
  return unit ? `${text} ${unit}` : text;
};

export const fmtHours = (value: unknown): string => `${fmtNumber(Number(value ?? 0), 2)} h`;

export const fmtPercent = (value: unknown, dp = 1): string => {
  const n = Number(value ?? 0);
  return `${(Number.isFinite(n) ? n : 0).toFixed(dp)}%`;
};

export const fmtDate = (value: unknown): string => {
  if (!value) return '—';
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const fmtDateTime = (value: unknown): string => {
  if (!value) return '—';
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return '—';
  return `${fmtDate(d)} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const fmtMonth = (year: number, month: number): string =>
  `${MONTHS[month - 1] ?? month} ${year}`;

/** Readable label from an enum-ish token, e.g. PARTIALLY_COMPLETED -> Partially completed. */
export const fmtLabel = (value: unknown): string => {
  const s = String(value ?? '').trim();
  if (!s) return '—';
  const lower = s.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

// ── Builder ────────────────────────────────────────────────────────────────

export class PdfBuilder {
  readonly doc: PDFKit.PDFDocument;
  private chunks: Buffer[] = [];
  private y: number;
  private readonly options: PdfDocOptions;
  private readonly generatedAt = new Date();

  constructor(options: PdfDocOptions) {
    this.options = options;
    // `bufferPages` lets the footer be stamped on every page once the total
    // page count is known.
    this.doc = new PDFDocument({ size: PAGE.size, margin: PAGE.margin, bufferPages: true });
    this.doc.on('data', (chunk) => this.chunks.push(chunk));
    this.y = this.drawLetterhead();
  }

  // ── Layout primitives ────────────────────────────────────────────────────

  private get left() {
    return PAGE.margin;
  }

  /** Starts a new page and returns the y position for content on it. */
  private newPage(): number {
    this.doc.addPage();
    return PAGE.margin;
  }

  /** Ensures `needed` vertical points remain; paginates when they don't. */
  private ensure(needed: number): void {
    if (this.y + needed > BOTTOM_LIMIT) {
      this.y = this.newPage();
    }
  }

  private drawLetterhead(): number {
    const { doc } = this;
    const org = this.options.organization;
    const bandHeight = 82;

    doc.rect(0, 0, PAGE.width, bandHeight).fill(THEME.ink);

    // Organisation identity, top-left.
    doc
      .fillColor(THEME.white)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(org?.name ?? 'Inventory Management System', this.left, 20, { width: 300, lineBreak: false });

    const orgLine = [org?.addressLine, org?.city, org?.country].filter(Boolean).join(', ');
    const contact = [org?.email, org?.phone].filter(Boolean).join('  ·  ');

    doc.font('Helvetica').fontSize(7.5).fillColor('#94A3B8');
    if (orgLine) doc.text(orgLine, this.left, 38, { width: 300, lineBreak: false });
    if (contact) doc.text(contact, this.left, 49, { width: 300, lineBreak: false });
    if (org?.registrationNumber) {
      doc.text(`Reg. No. ${org.registrationNumber}`, this.left, 60, { width: 300, lineBreak: false });
    }

    // Document title, top-right.
    doc
      .fillColor(THEME.white)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(this.options.title.toUpperCase(), PAGE.width / 2 - 20, 22, {
        width: CONTENT_WIDTH / 2 + 20,
        align: 'right',
      });

    if (this.options.subtitle) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#CBD5E1')
        .text(this.options.subtitle, PAGE.width / 2 - 20, 44, {
          width: CONTENT_WIDTH / 2 + 20,
          align: 'right',
        });
    }

    let y = bandHeight + 16;

    // Metadata band.
    const meta = this.options.meta ?? [];
    if (meta.length) {
      const rowHeight = 26;
      doc.rect(this.left, y, CONTENT_WIDTH, rowHeight).fill(THEME.band);

      const cell = CONTENT_WIDTH / meta.length;
      meta.forEach(([label, value], i) => {
        const x = this.left + i * cell + 8;
        doc.font('Helvetica').fontSize(6.5).fillColor(THEME.inkMute)
          .text(label.toUpperCase(), x, y + 5, { width: cell - 16, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(THEME.ink)
          .text(value, x, y + 14, { width: cell - 16, lineBreak: false });
      });

      y += rowHeight + 16;
    }

    doc.fillColor(THEME.ink);
    return y;
  }

  // ── Content blocks ───────────────────────────────────────────────────────

  /** Section heading with a rule beneath it. */
  section(title: string): this {
    this.ensure(34);
    this.doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor(THEME.ink)
      .text(title, this.left, this.y, { width: CONTENT_WIDTH });

    this.y += 15;
    this.doc.moveTo(this.left, this.y).lineTo(this.left + CONTENT_WIDTH, this.y)
      .lineWidth(0.75).strokeColor(THEME.lineStrong).stroke();
    this.y += 12;
    return this;
  }

  /** Headline figures rendered as a row of bordered tiles. */
  kpis(items: { label: string; value: string; tone?: 'default' | 'success' | 'warning' | 'danger' }[]): this {
    if (!items.length) return this;

    const perRow = Math.min(items.length, 4);
    const rows = Math.ceil(items.length / perRow);
    const tileWidth = CONTENT_WIDTH / perRow;
    const tileHeight = 44;

    this.ensure(rows * tileHeight + 10);

    items.forEach((item, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const x = this.left + col * tileWidth;
      const y = this.y + row * tileHeight;

      this.doc.rect(x, y, tileWidth, tileHeight).lineWidth(0.75).strokeColor(THEME.line).stroke();

      const tone =
        item.tone === 'success' ? THEME.success
        : item.tone === 'warning' ? THEME.warning
        : item.tone === 'danger' ? THEME.danger
        : THEME.ink;

      this.doc.font('Helvetica').fontSize(6.5).fillColor(THEME.inkMute)
        .text(item.label.toUpperCase(), x + 9, y + 9, { width: tileWidth - 18, lineBreak: false });
      this.doc.font('Helvetica-Bold').fontSize(11).fillColor(tone)
        .text(item.value, x + 9, y + 22, { width: tileWidth - 18, lineBreak: false });
    });

    this.y += rows * tileHeight + 16;
    this.doc.fillColor(THEME.ink);
    return this;
  }

  /**
   * Two-column label/value block, used for employee and period details.
   *
   * Row heights are measured rather than assumed: a long value (an email
   * address, a full address) wraps and pushes the following row down instead
   * of overlapping it.
   */
  keyValues(pairs: [string, string][], columns = 2): this {
    if (!pairs.length) return this;

    const colWidth = CONTENT_WIDTH / columns;
    const labelWidth = colWidth * 0.42;
    const valueWidth = colWidth * 0.58 - 12;

    // Group into rows first so each row can take the height of its tallest cell.
    const grouped: [string, string][][] = [];
    for (let i = 0; i < pairs.length; i += columns) {
      grouped.push(pairs.slice(i, i + columns));
    }

    for (const row of grouped) {
      this.doc.font('Helvetica-Bold').fontSize(8.5);
      const heights = row.map(([, value]) =>
        this.doc.heightOfString(String(value ?? '—'), { width: valueWidth }),
      );
      const rowHeight = Math.max(15, ...heights) + 5;

      this.ensure(rowHeight);

      row.forEach(([label, value], col) => {
        const x = this.left + col * colWidth;
        this.doc.font('Helvetica').fontSize(8.5).fillColor(THEME.inkMute)
          .text(label, x, this.y, { width: labelWidth, lineBreak: false });
        this.doc.font('Helvetica-Bold').fontSize(8.5).fillColor(THEME.ink)
          .text(String(value ?? '—'), x + labelWidth, this.y, { width: valueWidth });
      });

      this.y += rowHeight;
    }

    this.y += 12;
    this.doc.fillColor(THEME.ink);
    return this;
  }

  /**
   * Renders a table. Rows wrap to fit, never split across a page, and the
   * header band repeats whenever the table continues onto a new page.
   */
  table(config: {
    columns: PdfColumn[];
    rows: (string | number)[][];
    /** Optional emphasised final row (totals). */
    totals?: (string | number)[];
    zebra?: boolean;
    emptyMessage?: string;
  }): this {
    const { columns, rows, totals, zebra = true, emptyMessage = 'No records for this selection.' } = config;

    const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
    const widths = columns.map((c) => (c.width / totalWidth) * CONTENT_WIDTH);
    const PAD = 6;
    const HEADER_H = 20;

    if (!rows.length) {
      this.ensure(34);
      this.doc.rect(this.left, this.y, CONTENT_WIDTH, 30).fill(THEME.zebra);
      this.doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(THEME.inkMute)
        .text(emptyMessage, this.left, this.y + 11, { width: CONTENT_WIDTH, align: 'center' });
      this.y += 42;
      this.doc.fillColor(THEME.ink);
      return this;
    }

    const drawHeader = () => {
      this.doc.rect(this.left, this.y, CONTENT_WIDTH, HEADER_H).fill(THEME.band);
      let x = this.left;
      columns.forEach((col, i) => {
        this.doc.font('Helvetica-Bold').fontSize(7.5).fillColor(THEME.ink)
          .text(col.header.toUpperCase(), x + PAD, this.y + 6.5, {
            width: widths[i] - PAD * 2,
            align: col.align ?? 'left',
            lineBreak: false,
          });
        x += widths[i];
      });
      this.y += HEADER_H;
    };

    // Measures the tallest cell so the row can grow to fit wrapped text.
    const rowHeight = (cells: (string | number)[]) => {
      let tallest = 0;
      cells.forEach((cell, i) => {
        this.doc.font('Helvetica').fontSize(8);
        const h = this.doc.heightOfString(String(cell ?? ''), { width: widths[i] - PAD * 2 });
        if (h > tallest) tallest = h;
      });
      return Math.max(tallest + 9, 19);
    };

    this.ensure(HEADER_H + 30);
    drawHeader();

    rows.forEach((cells, index) => {
      const h = rowHeight(cells);

      // Keep rows whole: break before drawing rather than clipping.
      if (this.y + h > BOTTOM_LIMIT) {
        this.y = this.newPage();
        drawHeader();
      }

      if (zebra && index % 2 === 1) {
        this.doc.rect(this.left, this.y, CONTENT_WIDTH, h).fill(THEME.zebra);
      }

      let x = this.left;
      cells.forEach((cell, i) => {
        this.doc.font('Helvetica').fontSize(8).fillColor(THEME.inkSoft)
          .text(String(cell ?? ''), x + PAD, this.y + 5, {
            width: widths[i] - PAD * 2,
            align: columns[i].align ?? 'left',
          });
        x += widths[i];
      });

      this.doc.moveTo(this.left, this.y + h).lineTo(this.left + CONTENT_WIDTH, this.y + h)
        .lineWidth(0.5).strokeColor(THEME.line).stroke();

      this.y += h;
    });

    if (totals) {
      const h = 22;
      if (this.y + h > BOTTOM_LIMIT) {
        this.y = this.newPage();
        drawHeader();
      }
      this.doc.rect(this.left, this.y, CONTENT_WIDTH, h).fill(THEME.brandSoft);
      let x = this.left;
      totals.forEach((cell, i) => {
        this.doc.font('Helvetica-Bold').fontSize(8.5).fillColor(THEME.brandInk)
          .text(String(cell ?? ''), x + PAD, this.y + 6.5, {
            width: widths[i] - PAD * 2,
            align: columns[i].align ?? 'left',
            lineBreak: false,
          });
        x += widths[i];
      });
      this.y += h;
    }

    this.y += 16;
    this.doc.fillColor(THEME.ink);
    return this;
  }

  /** Emphasised single figure, e.g. a statement's net payable. */
  highlight(label: string, value: string, tone: 'brand' | 'danger' | 'success' = 'brand'): this {
    const h = 38;
    this.ensure(h + 8);

    const bg = tone === 'danger' ? '#FEF2F2' : tone === 'success' ? '#ECFDF5' : THEME.brandSoft;
    const fg = tone === 'danger' ? THEME.danger : tone === 'success' ? THEME.success : THEME.brandInk;

    this.doc.rect(this.left, this.y, CONTENT_WIDTH, h).fill(bg);
    this.doc.font('Helvetica-Bold').fontSize(10).fillColor(fg)
      .text(label.toUpperCase(), this.left + 12, this.y + 14, { width: CONTENT_WIDTH / 2, lineBreak: false });
    this.doc.font('Helvetica-Bold').fontSize(13).fillColor(fg)
      .text(value, this.left + CONTENT_WIDTH / 2, this.y + 11, {
        width: CONTENT_WIDTH / 2 - 12,
        align: 'right',
        lineBreak: false,
      });

    this.y += h + 16;
    this.doc.fillColor(THEME.ink);
    return this;
  }

  /** Small print beneath a section. */
  note(text: string): this {
    this.ensure(24);
    this.doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(THEME.inkMute)
      .text(text, this.left, this.y, { width: CONTENT_WIDTH });
    this.y = this.doc.y + 12;
    this.doc.fillColor(THEME.ink);
    return this;
  }

  spacer(points = 10): this {
    this.y += points;
    return this;
  }

  /** Stamps the footer on every buffered page, then resolves the PDF bytes. */
  finish(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.on('error', reject);

      try {
        const orgName = this.options.organization?.name ?? 'Inventory Management System';
        const stamp = fmtDateTime(this.generatedAt);
        const range = this.doc.bufferedPageRange();

        for (let i = 0; i < range.count; i++) {
          this.doc.switchToPage(range.start + i);

          const footerY = PAGE.height - PAGE.margin - 18;
          this.doc.moveTo(PAGE.margin, footerY).lineTo(PAGE.width - PAGE.margin, footerY)
            .lineWidth(0.5).strokeColor(THEME.line).stroke();

          this.doc.font('Helvetica').fontSize(7).fillColor(THEME.inkMute)
            .text(`${orgName}  ·  Generated ${stamp}`, PAGE.margin, footerY + 6, {
              width: CONTENT_WIDTH * 0.7,
              lineBreak: false,
            })
            .text(`Page ${i + 1} of ${range.count}`, PAGE.margin + CONTENT_WIDTH * 0.7, footerY + 6, {
              width: CONTENT_WIDTH * 0.3,
              align: 'right',
              lineBreak: false,
            });
        }

        // Flushing buffered pages is required before `end()` when bufferPages is on.
        this.doc.flushPages();
        this.doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

/** Loads the organisation row for a PDF letterhead, tolerating its absence. */
export async function loadOrganizationHeader(prisma: any): Promise<OrganizationHeader | null> {
  try {
    const org = await prisma.organizationProfile.findFirst();
    return org ?? null;
  } catch {
    return null;
  }
}
