import assert from 'assert';
import fs from 'fs';
import path from 'path';
import prisma from '../src/utils/prisma/prisma-client';
import { profileServices } from '../src/modules/profile/profile.service';
import { pdfGenerators } from '../src/utils/pdf/pdf-generator.util';
import { payrollServices } from '../src/modules/payroll/payroll.service';
import {
  DOCUMENT_TYPES,
  IMAGE_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  validateUpload,
  contentDisposition,
} from '../src/utils/files/file-validation.util';
import { resolvePrivatePath, privateStorage } from '../src/utils/storage/storage.service';

/**
 * Phase 12 — Profile, legal documents, private file storage & professional PDFs.
 */
async function runPhase12Tests() {
  console.log('🧪 Starting Backend Phase 12 Test Suite (Profile, Legal Documents & PDF Quality)...\n');

  let passed = 0;
  let failed = 0;

  const testPass = (name: string) => {
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  };
  const testFail = (name: string, err: any) => {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err?.message || err}`);
    failed++;
  };


  /**
   * Extracts the visible text from a generated PDF.
   *
   * PDFKit Flate-compresses each content stream and writes show-text operands
   * as hex strings, so neither a raw byte search nor a plain inflate finds the
   * rendered words — both layers have to be undone.
   */
  const pdfText = (buf: Buffer): string => {
    const zlib = require('zlib');
    let raw = '';
    let idx = 0;

    while (true) {
      const start = buf.indexOf('stream', idx);
      if (start === -1) break;
      let dataStart = start + 6;
      if (buf[dataStart] === 0x0d) dataStart++;
      if (buf[dataStart] === 0x0a) dataStart++;
      const end = buf.indexOf('endstream', dataStart);
      if (end === -1) break;

      const chunk = buf.subarray(dataStart, end);
      try {
        raw += zlib.inflateSync(chunk).toString('latin1');
      } catch {
        raw += chunk.toString('latin1');
      }
      idx = end + 9;
    }

    // Collect only the <hex> show-text operands and join them. Decoding them
    // in place would leave PDF operators and kerning offsets interleaved,
    // splitting words like "PAYROLL STATEMENT" across the noise between them.
    return (raw.match(/<[0-9A-Fa-f]+>/g) ?? [])
      .map((token) => {
        const hex = token.slice(1, -1);
        const even = hex.length % 2 ? hex.slice(0, -1) : hex;
        let text = '';
        for (let i = 0; i < even.length; i += 2) {
          text += String.fromCharCode(parseInt(even.slice(i, i + 2), 16));
        }
        return text;
      })
      .join('');
  };

  const uniqueId = Date.now();
  let employeeAId = '';
  let employeeBId = '';
  let documentId = '';

  // Minimal but genuinely valid fixtures.
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const pngBytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 1),
  ]);
  const htmlBytes = Buffer.from('<html><script>alert(1)</script></html>');

  const asFile = (data: Buffer, name: string, mimetype: string) => ({
    data,
    name,
    mimetype,
    size: data.length,
  });

  try {
    // ── Setup ───────────────────────────────────────────────────────────────
    const employeeA = await prisma.user.create({
      data: {
        email: `phase12.a.${uniqueId}@example.com`,
        password: 'hashed',
        role: 'EMPLOYEE',
        name: 'Phase12 Employee A',
        employeeProfile: { create: { hourlyRate: 100, department: 'Assembly' } },
      },
    });
    employeeAId = employeeA.id;

    const employeeB = await prisma.user.create({
      data: {
        email: `phase12.b.${uniqueId}@example.com`,
        password: 'hashed',
        role: 'EMPLOYEE',
        name: 'Phase12 Employee B',
        employeeProfile: { create: { hourlyRate: 100 } },
      },
    });
    employeeBId = employeeB.id;

    // ── TEST 1: Profile shape ───────────────────────────────────────────────
    try {
      const profile: any = await profileServices.getProfile(employeeAId);
      assert(profile.id === employeeAId, 'Profile returns the requested user');
      assert(!('password' in profile), 'Profile never exposes the password hash');
      assert(!('refreshTokenHash' in profile), 'Profile never exposes the refresh token hash');
      assert(profile.employeeProfile, 'Profile includes the employment record');
      testPass('Profile retrieval excludes credentials and includes employment data');
    } catch (err) { testFail('Profile retrieval excludes credentials', err); }

    // ── TEST 2: Self-service update writes the new personal fields ──────────
    try {
      const updated: any = await profileServices.updateMyProfile(employeeAId, {
        name: 'Phase12 Employee A',
        phone: '+880 1700 000000',
        address: '1 Test Road',
        dateOfBirth: new Date('1990-01-01'),
        nidNumber: '1234567890',
        emergencyContactName: 'Next Of Kin',
        emergencyContactPhone: '+880 1800 000000',
        emergencyContactRelationship: 'Sibling',
      } as any);
      assert(updated.nidNumber === '1234567890', 'NID persisted');
      assert(updated.emergencyContactName === 'Next Of Kin', 'Emergency contact persisted');
      assert(updated.dateOfBirth, 'Date of birth persisted');
      testPass('Self-service profile update persists personal & emergency fields');
    } catch (err) { testFail('Self-service profile update', err); }

    // ── TEST 3: Organisation-controlled fields are admin-only ───────────────
    try {
      const updated: any = await profileServices.adminUpdateProfile(employeeAId, {
        department: 'Assembly Line A',
        designation: 'Technician',
      } as any);
      assert(updated.employeeProfile.designation === 'Technician', 'Designation set by admin');
      assert(updated.employeeProfile.department === 'Assembly Line A', 'Department set by admin');
      testPass('Admin can set organisation-controlled designation & department');
    } catch (err) { testFail('Admin sets organisation-controlled fields', err); }

    // ── TEST 4: Upload validation rejects disguised & oversized files ───────
    try {
      assert.throws(
        () => validateUpload(asFile(htmlBytes, 'evil.png', 'image/png'), {
          allowed: DOCUMENT_TYPES, maxBytes: MAX_DOCUMENT_BYTES,
        }),
        /valid PNG/i,
        'HTML disguised as PNG is rejected on its magic bytes',
      );

      assert.throws(
        () => validateUpload(asFile(pdfBytes, 'doc.pdf', 'image/png'), {
          allowed: DOCUMENT_TYPES, maxBytes: MAX_DOCUMENT_BYTES,
        }),
        /doesn't match/i,
        'Extension/MIME mismatch is rejected',
      );

      assert.throws(
        () => validateUpload(
          { data: Buffer.concat([pdfBytes, Buffer.alloc(MAX_DOCUMENT_BYTES)]), name: 'big.pdf', mimetype: 'application/pdf', size: MAX_DOCUMENT_BYTES + pdfBytes.length },
          { allowed: DOCUMENT_TYPES, maxBytes: MAX_DOCUMENT_BYTES },
        ),
        /maximum accepted size/i,
        'Oversized upload is rejected',
      );

      assert.throws(
        () => validateUpload(asFile(pdfBytes, 'doc.pdf', 'application/pdf'), {
          allowed: IMAGE_TYPES, maxBytes: MAX_IMAGE_BYTES, label: 'image',
        }),
        /Unsupported image format/i,
        'A PDF is rejected where only images are allowed',
      );

      testPass('Upload validation rejects disguised, mismatched, oversized and wrong-kind files');
    } catch (err) { testFail('Upload validation rejection paths', err); }

    // ── TEST 5: Valid uploads are accepted and normalised ───────────────────
    try {
      const okPdf = validateUpload(asFile(pdfBytes, 'My Scan.pdf', 'application/pdf'), {
        allowed: DOCUMENT_TYPES, maxBytes: MAX_DOCUMENT_BYTES,
      });
      assert(okPdf.mimeType === 'application/pdf', 'PDF MIME normalised');
      assert(okPdf.extension === 'pdf', 'PDF extension normalised');

      const okPng = validateUpload(asFile(pngBytes, 'photo.png', 'image/png'), {
        allowed: IMAGE_TYPES, maxBytes: MAX_IMAGE_BYTES,
      });
      assert(okPng.mimeType === 'image/png', 'PNG MIME normalised');
      testPass('Valid PDF and PNG uploads pass validation with normalised metadata');
    } catch (err) { testFail('Valid upload acceptance', err); }

    // ── TEST 6: Client filenames never influence the stored path ───────────
    try {
      const traversal = validateUpload(
        asFile(pdfBytes, '../../../../etc/passwd.pdf', 'application/pdf'),
        { allowed: DOCUMENT_TYPES, maxBytes: MAX_DOCUMENT_BYTES },
      );
      assert(!traversal.originalFileName.includes('/'), 'Directory components stripped from the recorded filename');
      assert(traversal.originalFileName === 'passwd.pdf', 'Only the basename is retained');
      testPass('Client-supplied traversal filenames are reduced to a safe basename');
    } catch (err) { testFail('Filename sanitisation', err); }

    // ── TEST 7: Private path resolution refuses escapes ────────────────────
    try {
      for (const bad of ['../secret.pdf', '/etc/passwd', 'a/b.pdf', '..%2Fx.pdf', 'no-extension']) {
        assert.throws(() => resolvePrivatePath(bad), /Invalid storage identifier/, `Rejects "${bad}"`);
      }
      const good = resolvePrivatePath('abcd-1234.pdf');
      assert(good.endsWith('abcd-1234.pdf'), 'A well-formed storage id resolves');
      assert(good.includes(path.join('storage', 'private')), 'Resolves inside the private directory');
      testPass('Private path resolution blocks traversal and only accepts opaque ids');
    } catch (err) { testFail('Private path traversal guard', err); }

    // ── TEST 8: Documents are stored privately, outside the static root ────
    try {
      const doc: any = await profileServices.uploadDocument(
        employeeAId,
        { name: 'National ID', documentType: 'NID', category: 'PERSONAL', expiryDate: null, notes: null } as any,
        asFile(pdfBytes, 'nid.pdf', 'application/pdf'),
      );
      documentId = doc.id;

      assert(!('fileStorageId' in doc), 'Storage id is not returned to clients');
      assert(!('fileUrl' in doc), 'No public URL is returned to clients');
      assert(doc.mimeType === 'application/pdf', 'MIME type recorded');
      assert(doc.fileSize === pdfBytes.length, 'File size recorded');
      assert(doc.originalFileName === 'nid.pdf', 'Original filename recorded');

      const raw = await profileServices.getDocumentRaw(documentId);
      assert(raw?.isPrivate === true, 'Document flagged private');
      assert(raw?.fileUrl === null, 'No public URL persisted');

      const publicDir = path.join(__dirname, '..', 'public', 'uploads');
      const publicCopy = path.join(publicDir, raw!.fileStorageId);
      assert(!fs.existsSync(publicCopy), 'Document is NOT written into the publicly served directory');
      assert(privateStorage.exists(raw!.fileStorageId), 'Document exists in private storage');

      testPass('Legal documents are stored privately and never in the static public directory');
    } catch (err) { testFail('Private document storage', err); }

    // ── TEST 9: Reading a document back returns the original bytes ─────────
    try {
      const file = await profileServices.readDocumentFile(documentId);
      assert(file.buffer.equals(pdfBytes), 'Stored bytes round-trip unchanged');
      assert(file.mimeType === 'application/pdf', 'MIME type returned for streaming');
      assert(file.fileName === 'nid.pdf', 'Original filename returned for the download header');
      testPass('Authenticated document read returns the original bytes and metadata');
    } catch (err) { testFail('Document read-back', err); }

    // ── TEST 10: Ownership is resolved from the document row ───────────────
    try {
      const raw = await profileServices.getDocumentRaw(documentId);
      assert(raw?.userId === employeeAId, 'Document is owned by its uploader');
      assert(raw?.userId !== employeeBId, 'Document is not owned by an unrelated employee');

      const bDocs = await profileServices.listDocuments(employeeBId, {} as any);
      assert(bDocs.length === 0, 'A different employee sees none of these documents');
      testPass('Document ownership is resolvable and scoped per employee (IDOR guard input)');
    } catch (err) { testFail('Document ownership scoping', err); }

    // ── TEST 11: Replacing a document swaps the stored file ────────────────
    try {
      const before = await profileServices.getDocumentRaw(documentId);
      const replaced: any = await profileServices.updateDocument(
        documentId,
        { name: 'National ID (updated)' } as any,
        asFile(pngBytes, 'nid.png', 'image/png'),
      );
      const after = await profileServices.getDocumentRaw(documentId);

      assert(replaced.name === 'National ID (updated)', 'Metadata updated');
      assert(after!.fileStorageId !== before!.fileStorageId, 'A new storage id is issued on replacement');
      assert(after!.mimeType === 'image/png', 'MIME type updated to the replacement');
      assert(!privateStorage.exists(before!.fileStorageId), 'The superseded file is removed from disk');
      testPass('Document replacement swaps the stored file and cleans up the previous one');
    } catch (err) { testFail('Document replacement', err); }

    // ── TEST 12: Deleting removes both row and file ────────────────────────
    try {
      const raw = await profileServices.getDocumentRaw(documentId);
      const storageId = raw!.fileStorageId;

      await profileServices.deleteDocument(documentId);

      const gone = await profileServices.getDocumentRaw(documentId);
      assert(gone === null, 'Document row deleted');
      assert(!privateStorage.exists(storageId), 'Stored file deleted from disk');
      testPass('Document deletion removes the database row and the stored file');
    } catch (err) { testFail('Document deletion', err); }

    // ── TEST 13: Content-Disposition is safe for hostile filenames ─────────
    try {
      const header = contentDisposition('attachment', 'my "report"\; drop.pdf');
      assert(!/[\r\n]/.test(header), 'No CRLF injection in the header');
      assert(header.includes("filename*=UTF-8''"), 'RFC 5987 encoded filename present');
      const unicode = contentDisposition('inline', 'রিপোর্ট.pdf');
      assert(unicode.includes("filename*=UTF-8''"), 'Unicode filenames are encoded, not dropped');
      testPass('Content-Disposition header is safely encoded for hostile and unicode filenames');
    } catch (err) { testFail('Content-Disposition safety', err); }

    // ── TEST 14: Organisation profile is a stable singleton ────────────────
    try {
      const first = await profileServices.getOrganization();
      const second = await profileServices.getOrganization();
      assert(first.id === second.id, 'Organisation profile is a singleton row');

      const updated = await profileServices.updateOrganization(
        { name: 'Phase12 Test Org', registrationNumber: 'REG-12' } as any,
        employeeAId,
      );
      assert(updated.name === 'Phase12 Test Org', 'Organisation name persisted');
      assert(updated.registrationNumber === 'REG-12', 'Registration number persisted');
      testPass('Organisation profile behaves as a singleton and persists business details');
    } catch (err) { testFail('Organisation profile', err); }

    // ── TEST 15: Every report PDF is valid and paginated ───────────────────
    try {
      const inventory = await import('../src/modules/reports/reports.service');
      const invData = await inventory.reportServices.getInventoryReport({} as any);
      const buffers: [string, Buffer][] = [
        ['inventory', await pdfGenerators.generateInventoryPDF(invData)],
        ['production', await pdfGenerators.generateProductionPDF(await inventory.reportServices.getProductionReport({} as any))],
        ['attendance', await pdfGenerators.generateAttendancePDF(await inventory.reportServices.getAttendanceReport({} as any))],
        ['payroll', await pdfGenerators.generatePayrollPDF(await inventory.reportServices.getPayrollReport({} as any))],
        ['stock-movements', await pdfGenerators.generateStockMovementPDF(await inventory.reportServices.getStockMovementReport({} as any))],
      ];

      for (const [name, buf] of buffers) {
        assert(buf.length > 800, `${name} PDF has real content`);
        assert(buf.subarray(0, 5).toString() === '%PDF-', `${name} PDF has a valid header`);
        assert(buf.subarray(-8).toString().includes('%%EOF'), `${name} PDF is properly terminated`);
        const text = pdfText(buf);
        assert(/Page 1 of/.test(text), `${name} PDF carries page numbering`);
        assert(/Generated/.test(text), `${name} PDF carries a generated-on footer`);
      }
      testPass('All report PDFs generate valid, page-numbered documents');
    } catch (err) { testFail('Report PDF generation', err); }

    // ── TEST 16: Payroll statement reads as a real salary slip ─────────────
    try {
      const now = new Date();
      const buf = await payrollServices.generatePayrollStatementPdf(
        employeeAId, now.getFullYear(), now.getMonth() + 1,
      );
      assert(buf.subarray(0, 5).toString() === '%PDF-', 'Statement is a valid PDF');
      const text = pdfText(buf);
      assert(/PAYROLL STATEMENT/.test(text), 'Statement is titled');
      assert(/NET PAYABLE/.test(text), 'Statement shows the net payable figure');
      assert(/Employee details/.test(text), 'Statement includes an employee details section');
      assert(/Earnings/.test(text), 'Statement includes an earnings section');
      assert(/Page 1 of/.test(text), 'Statement carries page numbering');
      testPass('Payroll statement PDF renders as a structured salary statement');
    } catch (err) { testFail('Payroll statement PDF', err); }

    // ── TEST 17: Avatars use the public lane, documents the private one ────
    try {
      const withAvatar: any = await profileServices.updateAvatar(
        employeeAId, asFile(pngBytes, 'me.png', 'image/png'),
      );
      assert(withAvatar.avatarUrl, 'Avatar exposes a public URL (it is not a legal document)');

      const cleared: any = await profileServices.removeAvatar(employeeAId);
      assert(cleared.avatarUrl === null, 'Avatar can be removed');
      testPass('Profile photos use the public asset lane and can be replaced or removed');
    } catch (err) { testFail('Avatar lifecycle', err); }

    // ── Cleanup ─────────────────────────────────────────────────────────────
    for (const id of [employeeAId, employeeBId]) {
      const docs = await prisma.employeeDocument.findMany({ where: { userId: id } });
      for (const d of docs) {
        if (d.isPrivate) await privateStorage.deleteFile(d.fileStorageId).catch(() => undefined);
      }
      await prisma.employeeDocument.deleteMany({ where: { userId: id } });
      await prisma.employeeProfile.deleteMany({ where: { userId: id } });
      await prisma.organizationProfile.updateMany({ where: { updatedById: id }, data: { updatedById: null } });
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }

    console.log(`\n📊 Phase 12 Test Results: ${passed} Passed, ${failed} Failed`);
    if (failed > 0) process.exitCode = 1;
  } catch (err: any) {
    console.error('\n💥 Phase 12 test suite crashed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runPhase12Tests();
